# Module 13 — ASP.NET Core: Configuration & the Options Pattern Internals

> Domain:.NET / ASP.NET Core | Level: Beginner → Expert | Prerequisite: [[02-DI-Container-Internals]] (service lifetimes — `IOptionsMonitor` as the "safe to hold long-term" example referenced there)

---

## 1. Topic Description

### Definition

**Configuration** in .NET is a layered, flattened key-value store: each provider (JSON files, environment variables, command line, user secrets, a secret store) contributes keys, and where several supply the same key the **last provider added wins**. Nested structure is flattened with `:` separators (`__` in environment variables). The **options pattern** is the typed consumption model on top: a POCO is bound to a configuration section, validated, and injected as `IOptions<T>`, `IOptionsSnapshot<T>` or `IOptionsMonitor<T>` depending on whether the value is fixed for the process, recomputed per scope, or must be observed as it changes.

### Core sub-concepts

- **Provider layering and precedence** — the default host builder's order, and `__` versus `:` in environment variables.
- **Binding to typed options** — section binding, and the silent failure when a section is missing or renamed.
- **The three options interfaces** — `IOptions<T>` (singleton, fixed), `IOptionsSnapshot<T>` (scoped, per-request), `IOptionsMonitor<T>` (singleton, change-aware) and the captive-dependency trap between them.
- **Named options** — several configured instances of one type, resolved via `IOptionsMonitor<T>.Get(name)`; the mechanism behind named `HttpClient` configuration.
- **Validation** — data annotations, `IValidateOptions<T>` for cross-field rules, and `ValidateOnStart` to move failure from first use to deployment.
- **`reloadOnChange` and change tokens** — what reload actually propagates to, and the large set of consumers it silently does not reach.
- **Configuration vs secrets vs feature flags** — three different lifecycles (static, rotated and access-audited, dynamically targeted) that share one `IConfiguration` surface.
- **Secret sourcing** — managed stores, platform injection, user secrets in development; rotation as a first-class requirement.
- **Environment-specific behaviour** — configuration values describing behaviour versus code branching on the environment name.
- **Containerised supply** — environment variables and mounted files; the same artefact promoted unchanged through environments.
- **Remote configuration providers** — startup dependency, caching last-known-good, and fail-fast versus hang.
- **Effective-configuration visibility** — diagnosing what the process actually sees, with redaction.

### Where it fits

Configuration is consumed by nearly every other component: connection strings for the data layer, issuer and key metadata for authentication, exporter endpoints for telemetry, limits for the pipeline. It is resolved through the DI container, so options lifetimes are container lifetimes and inherit the same captive-dependency hazards. It is also the seam between a build artefact and an environment, which is what makes "promote the same image" a viable deployment model.

### Why it matters at scale

Misconfiguration causes outages at roughly the rate code changes do, while being applied with far less care because it feels lighter. The specific amplifier is **silent binding**: a renamed or misspelled section binds successfully to a default-constructed object, so the service starts happily and behaves as though every setting were unset — no error, no log, just wrong behaviour discovered later. Without `ValidateOnStart`, an invalid value surfaces the first time a rarely-used path executes, which is typically in production at an inconvenient hour rather than during the rollout. And a remote configuration provider on the startup path turns a dependency's outage into an inability to *scale or deploy*, precisely when you most need to.

### Common pitfalls / anti-patterns

- **A missing or renamed section binding silently to defaults** — no exception, no warning; the service runs with empty strings and zeros until something downstream fails obscurely.
- **Injecting `IConfiguration` throughout the codebase** — every consumer does untyped string lookups, typos become runtime nulls, nothing validates, and no constructor reveals what a class actually depends on.
- **`IOptionsSnapshot<T>` injected into a singleton** — a captive dependency: the first scope's values are frozen for the process lifetime.
- **Expecting `IOptions<T>` to pick up a reloaded value** — it is computed once; the "config change had no effect" report almost always traces to this or to precedence.
- **Secrets in `appsettings.json`** — permanently in git history, visible to everyone with repository access, and unrotatable without a code change and deployment.
- **Branching on the environment name (`if (env.IsProduction())`)** — the non-production path is never exercised in production and vice versa, so you ship code that has never run in its target configuration.
- **Validating only on first use** — a deployment that should have failed instead succeeds, and the invalid value becomes an incident hours later on a cold path.
- **Business logic expressed as configuration** — rule tables and conditional behaviour get no type checking, no tests and no review discipline, and produce bugs reproducible only under one settings combination.

> Scope note: DI lifetimes and captive dependencies belong to `02-DI-Container-Internals`; startup pipeline composition to `01-Middleware-Pipeline-Request-Internals`; health-check and readiness reporting to `06-HealthChecks-Observability`.

---

## 2. Beginner (10 Q&A)

**Q1. The section is named `Smtp` in appsettings but the class binds to `"SMTP"`. What happens?**
```csharp
services.Configure<SmtpOptions>(config.GetSection("SMTP"));
```
**A:** Binding succeeds and gives you a default-constructed object — empty strings, zeros, nulls — with no error at all. The app starts happily and behaves as though every setting were unset, and you find out when mail silently fails. That silent success is the single most important thing to know about configuration binding, and it's why validation isn't decoration: it's what turns a misconfiguration into a loud failure.
*Follow-up: How would you make a missing connection string fail at startup rather than at first query?*

**Q2. `IOptions<T>`, `IOptionsSnapshot<T>`, `IOptionsMonitor<T>` — which and when?**
**A:** `IOptions<T>` is a singleton computed once; the value never changes for the process lifetime. `IOptionsSnapshot<T>` is scoped and recomputed per scope, so a request picks up changes — but a singleton can't use it. `IOptionsMonitor<T>` is a singleton exposing the current value plus change notification, so it's the one for singletons and background services that must react. Pick the wrong one and you get either a value that never updates or a captive-dependency bug, and both fail quietly.
*Follow-up: What happens if a singleton injects `IOptionsSnapshot<T>`?*

**Q3. What does `ValidateOnStart` buy you?**
**A:** It forces validation during startup rather than lazily on first resolution, so a service with invalid configuration fails immediately and visibly instead of starting successfully and throwing hours later on a rarely-used path. That difference is the whole point: a crash at deploy time is caught by the rollout; a failure at 2 a.m. on a cold path is an incident. I'd treat startup validation of all options as a baseline requirement.
*Follow-up: Failing fast in Kubernetes means crash-looping. Is that better or worse?*

**Q4. Why doesn't this pick up the changed value?**
```csharp
public class RateLimiter {
    public RateLimiter(IOptions<LimitOptions> o) { _max = o.Value.Max; }
}
```
**A:** Two reasons stacked. `IOptions<T>` is computed once, so it never sees a reload. And even with `IOptionsMonitor`, the value is captured into `_max` in the constructor, so nothing re-reads it. Reload only reaches code that consumes the value *at the point of use* through the monitor. That's why "the config reload didn't take effect" almost always traces to either the wrong interface or a captured value.
*Follow-up: Which settings would you deliberately make restart-only?*

**Q5. How do configuration providers layer?**
**A:** Each provider contributes flat key-value pairs, and when the same key exists in several, the *last provider added wins*. The default host builder adds appsettings.json, then appsettings.{Environment}.json, then user secrets in Development, then environment variables, then command line — which is how one image behaves differently per environment. Nested JSON flattens to `Section:Sub:Key`, and in environment variables the separator is `__` because `:` isn't portable.
*Follow-up: You set an environment variable and nothing changes. Three most likely reasons?*

**Q6. Why not put the connection string in `appsettings.json`?**
**A:** It's in git history forever, visible to everyone with repository access, and can't be rotated without a code change and deployment. Secrets belong in a managed store or injected by the platform, with user secrets covering development. The underlying point is that a secret's lifecycle — rotation, access control, audit — is fundamentally different from configuration's, so it needs a different mechanism even though it arrives through the same `IConfiguration` interface.
*Follow-up: A secret must be rotated. What does your service need to do to pick up the new value?*

**Q7. What are named options for?**
**A:** Registering several configured instances of the same options type under different names — one per downstream client, per tenant, per queue — resolved via `IOptionsMonitor<T>.Get(name)`. Without them you'd need a distinct type per instance, producing near-duplicate classes. It's the mechanism behind named `HttpClient` configuration, and the typical use is a service talking to several instances of the same kind of dependency with different endpoints and credentials.
*Follow-up: How do you validate named options, given validation is registered per name?*

**Q8. What's wrong with this?**
```csharp
if (_env.IsProduction())
    await _realPaymentGateway.ChargeAsync(o);
else
    _logger.LogInformation("Would charge {Amount}", o.Total);
```
**A:** The production path has never run outside production. Branching on the environment name means you ship code whose behaviour in its target environment has never been exercised, and the non-production path drifts because nobody tests it. Configure the *behaviour* instead — a gateway endpoint, or a registered implementation chosen by configuration — so there's one code path with different data. Legitimate environment checks are narrow: developer conveniences like the developer exception page.
*Follow-up: A feature must be off in production until launch. Config flag or environment check?*

**Q9. How do you supply configuration to a containerised app?**
**A:** Environment variables and mounted files, with the image carrying only defaults so the same artefact is promoted through environments unchanged. In Kubernetes, ConfigMaps for non-secret values and Secrets or an external secret store for sensitive ones. The discipline that matters is that the image must never contain environment-specific configuration, because that breaks the promote-the-same-artefact model and means what you tested in staging isn't what you deployed.
*Follow-up: A mounted ConfigMap is updated. Does your running pod see it?*

**Q10. What does `reloadOnChange` actually reach?**
**A:** It re-reads configuration on file change and fires change tokens, so `IOptionsSnapshot` and `IOptionsMonitor` see new values. What it does *not* do is propagate into anything that already captured a value — a singleton that read a setting in its constructor, a connection string used to build a pooled factory, a client configured at startup. So reload works for values consumed through the monitor at point of use, and silently doesn't for everything else.
*Follow-up: Half your instances picked up the new value and half didn't. What state are you in?*

---

## 3. Intermediate (10 Q&A)

**Q1. A setting change was deployed and had no effect. Diagnosis?**
**A:** Start from what the process actually sees, ideally a diagnostic endpoint dumping effective configuration keys with sources and secrets redacted — that alone resolves most of these. Usual causes: precedence (an environment variable or command-line argument overriding the file you edited), a mismatched key path or `__` versus `:`, the value consumed through `IOptions<T>` so it was captured at startup, or a value read once into a field. In a container it may simply be that the deployment didn't restart the pod. The lesson is to debug from observed state, not intended state.
*Follow-up: How would you build that effective-configuration endpoint without creating a leak risk?*

**Q2. How do you design options validation for a service with many settings?**
**A:** Validate at startup, comprehensively, with messages naming the key and saying what was wrong — the error message is the whole value here, since "configuration invalid" is barely better than nothing. Data annotations cover simple constraints; `IValidateOptions<T>` handles cross-field rules like "if authentication is enabled these three are required". Validate semantics where cheap: a URL parses, a timeout is in range, an endpoint is reachable if the check is fast and safe. The goal is that an invalid configuration cannot be deployed successfully.
*Follow-up: Validation that hits the network at startup makes the service fail when a dependency is down. Where's the line?*

**Q3. How do you handle configuration that must change without a restart?**
**A:** Consume it through `IOptionsMonitor<T>` at the point of use rather than capturing it, and design the consuming components to be reconfigurable — which is the hard part, because a value baked into a pooled client, a connection factory or a compiled policy won't change even when the monitor fires. Where a component genuinely can't be reconfigured in place, the honest options are rebuilding it on change or declaring the setting restart-only. Be explicit about which settings are hot-reloadable, because an implicit assumption that everything is turns a "config-only change" into a partially-applied state where components disagree.
*Follow-up: How do you make reload atomic when two related settings must change together?*

**Q4. Configuration or feature flags — where's the line?**
**A:** Configuration is relatively static, deployment-scoped, and changes with a release or an operational action. Feature flags are dynamic, often per-user or per-percentage, and exist to decouple deploy from release. Running experiments through configuration files gives you no targeting, no gradual rollout and no audit of who changed what; conversely putting infrastructure settings in a flag system adds a runtime dependency to something that should be static. Use a real flag system for release control, keep infrastructure in configuration, and be strict about flags having owners and expiry dates.
*Follow-up: A flag has been in the codebase for two years. What's the removal process?*

**Q5. What's the risk of a provider that fetches configuration from a remote store at startup?**
**A:** It makes that store a hard startup dependency, so an outage or a throttle stops your service starting — turning a degraded dependency into an inability to deploy or scale, which is exactly when you most need to. Mitigations: cache the last known good configuration, retry with backoff, fail fast with a clear error rather than hanging, and be deliberate about which values genuinely need to come from remote. Watch the startup latency it adds too, since a remote fetch on every pod start multiplies by your scale-out rate.
*Follow-up: The secret store is down and you need to scale up during an incident. What should happen?*

**Q6. How do you keep configuration consistent across environments?**
**A:** Make the *schema* the shared artefact and the values environment-specific — a strongly-typed options class with validation *is* that schema, so an environment missing a required value fails at deploy rather than at runtime. Keep environment configuration in version control (secrets referenced, not embedded) so changes are reviewable and drift is visible. The failure mode to design against is a production-only value that exists nowhere else, since by definition it's never exercised before it matters.
*Follow-up: How do you handle a value that genuinely only exists in production, like a partner's live endpoint?*

**Q7. How do you avoid leaking secrets through configuration?**
**A:** Multiple controls, because one will fail. Secrets never in source control, enforced by pre-commit and CI scanning. Never logged, enforced by redaction in the logging pipeline and by not dumping configuration wholesale. Never in error messages or diagnostic endpoints. Distinguished in the type system or by convention so redaction is mechanical rather than remembered. And assume a leak will happen: make rotation fast and routine, because the ability to rotate a credential in minutes is worth more than the belief it'll never leak.
*Follow-up: A connection string appears in an exception message in your logs. Immediate and structural response?*

**Q8. How do you test configuration code?**
**A:** Unit tests construct the options object directly — that's the point of the pattern. What actually needs testing is the *binding and validation*: build a configuration from an in-memory or file source and assert valid input binds correctly and invalid input fails with a useful message, including the missing-section case, which is the silent one. I'd also add a startup test per environment configuration where feasible, asserting the host can be built with that environment's non-secret settings, which catches renamed keys and missing required values before deployment.
*Follow-up: How would you test that production's configuration is valid without production's secrets in CI?*

**Q9. What are the trade-offs of a shared configuration library across services?**
**A:** It gives consistent provider setup, standard validation, secret handling and naming, so every service gets correct behaviour by default and platform changes propagate once — valuable at scale. The costs are coupling every service's startup to a shared component, a versioning burden, and the risk of it accumulating opinions that don't fit everyone. Keep it narrowly scoped to provider composition and cross-cutting settings, avoid embedding business configuration, and version it so teams upgrade deliberately. A bug in shared startup code is an estate-wide incident, which argues for a small surface and a canary rollout.
*Follow-up: You need to change a default in the shared library. How do you roll that out?*

**Q10. What belongs in configuration and what doesn't?**
**A:** Configuration is for things that legitimately differ per environment or deployment: endpoints, credentials, timeouts, limits, toggles, scaling parameters. What doesn't belong is business logic expressed as data — rule tables, complex conditional behaviour, workflow definitions — because configuration has no tests, no type checking beyond binding, no review culture equal to code, and no way to reason about combinations. The tell is a configuration file needing a document to understand, or a bug reproducible only with a specific settings combination. When logic ends up in configuration it usually means someone wanted to avoid a deployment, and the right fix is making deployment cheap.
*Follow-up: The business wants to change pricing rules without a deploy. How do you accommodate that safely?*

---

## 4. Expert / Architect (10 Q&A)

**Q1. Design configuration management for fifty services across four environments.**
**A:** One artefact promoted unchanged, with all environment-specific values supplied externally — that's the property making staging meaningful. Configuration in version control with review; secrets in a managed store referenced by identity rather than embedded; a typed schema per service so a missing or invalid value fails the *deployment* rather than the service. Standardise provider composition in a platform package so every service resolves configuration identically, and insist on a diffable representation of each environment's effective configuration, because drift between environments is the root cause of a large share of "works in staging" incidents.
*Follow-up: How do you detect configuration drift between environments automatically?*

**Q2. Should configuration changes be treated as deployments?**
**A:** Yes, with the same rigour: reviewed, versioned, rolled out progressively, observable, reversible. Configuration changes cause outages at roughly the same rate as code changes and are usually applied with far less care precisely because they feel lighter — which is the asymmetry that makes them dangerous. Practically that means the same pipeline, a canary where possible, and an explicit rollback. The counter-argument is that emergency changes need to be fast; I'd handle that with a documented break-glass path that's audited afterwards, rather than leaving the normal path unguarded.
*Follow-up: An incident requires a config change in two minutes. What does your break-glass path look like?*

**Q3. How do you handle per-tenant configuration at scale?**
**A:** Not through the standard configuration system, which is designed for a fixed set of keys read at startup, not thousands of tenant records. Tenant configuration is *data*: it lives in a store, is loaded and cached per tenant with an explicit invalidation strategy, and is accessed through a tenant-aware abstraction rather than `IConfiguration`. The design questions that matter are cache staleness (how quickly a tenant's change takes effect), failure behaviour when the store is unavailable (serve stale or fail closed, depending on whether the setting is security-relevant), and defaults versus overrides. Conflating this with application configuration produces both a scaling problem and an isolation risk.
*Follow-up: A tenant's setting change must take effect within 30 seconds across all instances. How do you build that?*

**Q4. What's your approach to configuration in a regulated environment?**
**A:** Change-managed like code: every change attributable to a person, reviewed, linked to a ticket, with the effective state at any past time reconstructable — which usually means version control as the source of truth and a pipeline applying it, rather than console edits. Secrets need separate handling with access audited independently, since who *read* a secret matters as much as who changed it. The running system's effective configuration must be evidenceable, not just the intended configuration, because an auditor asks what the system was actually doing. Direct production edits should be technically impossible outside break-glass, since a control relying on people not doing something isn't a control.
*Follow-up: An engineer changed a production setting in the portal. What does your process require now?*

**Q5. How would you approach migrating to a centralised configuration service?**
**A:** Incrementally, with a clear picture of what it buys, because it adds a runtime dependency to something that previously couldn't fail. Move non-critical values first, keep local defaults as a fallback so a service can start without it, and cache last known good state so an outage degrades rather than prevents startup. The migration also needs an answer for change-propagation semantics — whether all instances take a change simultaneously and what happens if they don't — since that's a new failure mode file-based configuration didn't have. I'd want a concrete driver like dynamic reconfiguration or centralised audit; "it's more modern" doesn't justify a critical-path dependency.
*Follow-up: The config service becomes a single point of failure for the estate. How do you mitigate?*

**Q6. How do you stop configuration becoming an unmanageable surface over years?**
**A:** Treat settings as API: each has an owner, a documented purpose, a default and validation, and adding one requires the same review as adding a public method. Periodically audit for settings nobody sets and for values identical across all environments — most long-lived services accumulate dozens, and both should be removed or made constants. Resist adding a toggle for every uncertainty, since each doubles the state space and almost none get exercised in combination. The most effective single control is requiring a new setting to come with validation and a test, which raises the cost just enough to discourage casual additions.
*Follow-up: You find 200 settings and 40 unused. How do you remove them safely?*

**Q7. What failure modes have you seen from configuration reload?**
**A:** Partial application, where some components see the new value and others don't, leaving a state nobody designed or tested. Reload triggered by a partial file write, so the application briefly reads invalid configuration. And reload cascading into expensive reinitialisation across every instance simultaneously. The designs that avoid these: validate the new configuration before applying and reject invalid states outright; make reload atomic at the component level rather than per-value; stagger reloads across instances; and be explicit that some settings are restart-only. Emit a clear event on every reload with the resulting version, so a later incident can be correlated to a config change.
*Follow-up: How do you make reload atomic when two settings must change together?*

**Q8. How does configuration design interact with startup and readiness?**
**A:** Fail-fast validation is correct, but it interacts with orchestration: a service that can't start crash-loops, and if the rollout strategy is wrong that can take down healthy instances too. So the pairing that matters is fail-fast validation *plus* a deployment strategy keeping existing instances serving until new ones are healthy, and readiness reflecting genuine ability to serve rather than just process liveness. I'd also distinguish configuration errors from dependency unavailability in the failure message, because they need different responses — one is a rollback, the other is a wait.
*Follow-up: A bad config is deployed and new pods crash-loop. What should the system do automatically?*

**Q9. How would you evaluate moving all configuration into environment variables?**
**A:** Real merits — twelve-factor alignment, container-native, no file mounting, clear precedence — and real limits: they're flat, awkward for hierarchical or list-shaped configuration, visible in process listings and to anything that can read the environment, and not reloadable without a restart. For a service with modest scalar settings it's a good default; for structured configuration it produces unreadable key names and error-prone escaping. My position is a mixed model — structured defaults in files shipped with the artefact, environment-specific scalars and secrets from the environment or a secret store — with the important part being consistency across the estate so engineers don't learn a new scheme per service.
*Follow-up: A secret in an environment variable is readable by any process in the container. Does that change your view?*

**Q10. What signals tell you an organisation's configuration practice is unhealthy?**
**A:** Incidents caused by configuration outnumbering those caused by code. Settings changed directly in production consoles. The same value defined in three places with different values. No way to answer what configuration a running instance actually has. Secrets found in repositories. Deployments differing between environments in ways nobody can enumerate. Each is a symptom of the same root cause — configuration treated as an afterthought rather than part of the system. I'd start remediation with *visibility*, because you can't fix drift you can't see: an effective-configuration endpoint plus environment diffing usually surfaces more real risk in a week than a policy document does in a year.
*Follow-up: You get that visibility and it's worse than expected. How do you prioritise?*

---

## 5. Reference Material

> Retained from the original module: deep-dive internals, diagrams, production examples, exercises, system/low-level design, debugging walkthroughs and the Principal Engineer perspective.

### 1. Fundamentals

#### What is `IConfiguration`, and what is the Options pattern?
`IConfiguration` is ASP.NET Core's unified abstraction over configuration data from many sources (JSON files, environment variables, command-line args, Azure Key Vault, secrets manager) merged into one hierarchical key/value structure. The **Options pattern** (`IOptions<T>`/`IOptionsSnapshot<T>`/`IOptionsMonitor<T>`) is the recommended way to **consume** that configuration — binding a section of raw key/value data into a strongly-typed POCO class, injected via DI, instead of scattering `configuration["Some:Key"]` string-indexed lookups throughout application code.

#### Why does it exist?
Raw `IConfiguration` access is stringly-typed (no compile-time checking of key names, no type safety) and provides no built-in mechanism for live-reloading or per-request-consistent snapshots. The Options pattern layers strong typing, validation, and three distinct reload/lifetime semantics on top, solving different consumption needs cleanly.

#### When does it matter?
Every configurable service uses this; the depth matters for correctly choosing among the three options interfaces (a frequent point of confusion) and for understanding configuration-source layering/precedence when debugging "why is this setting not what I expect."

#### How does it work (30,000-ft view)?
```csharp
builder.Services.Configure<SmtpOptions>(builder.Configuration.GetSection("Smtp"));

public class EmailSender
{
    private readonly IOptionsMonitor<SmtpOptions> _options; // always current
    public EmailSender(IOptionsMonitor<SmtpOptions> options) => _options = options;
    public void Send => Connect(_options.CurrentValue.Host);
}
```

### 2. Deep Dive

#### 2.1 Configuration Source Layering and Precedence
Sources are added in order (`appsettings.json` → `appsettings.{Environment}.json` → environment variables → command-line args → user secrets in Development) — **later sources override earlier ones** for the same key. This is why environment variables can override a JSON file's value without redeploying, and why command-line args (highest precedence by default) are used for one-off overrides.

#### 2.2 `IOptions<T>` vs `IOptionsSnapshot<T>` vs `IOptionsMonitor<T>`
- **`IOptions<T>`**: `Singleton`-lifetime-safe, computed **once** and cached forever — never reflects later configuration changes. Simplest, but stale-by-design.
- **`IOptionsSnapshot<T>`**: `Scoped` — recomputed **once per request/scope**, reflecting the configuration as of that scope's start. Good for per-request consistency with reload support, but **cannot be injected into a `Singleton`** (a captive-dependency violation, directly the rule — `IOptionsSnapshot<T>` is literally `Scoped`).
- **`IOptionsMonitor<T>`**: `Singleton`-safe, but **always current** via `.CurrentValue` (re-reads on change) and supports `.OnChange(callback)` for reactive updates — this is precisely why §Advanced Q6 cited it as the canonical example of "safe for a Singleton to hold long-term because it's designed to be a live view, not a frozen snapshot."

#### 2.3 Options Validation
`services.AddOptions<SmtpOptions>.Bind(config.GetSection("Smtp")).ValidateDataAnnotations.ValidateOnStart` — `ValidateOnStart` (rather than lazy, first-use validation) forces invalid configuration to fail the application at **startup**, not on the first request that happens to touch it — directly the same "fail fast, fail loud, fail at build/start time not runtime" principle recurring throughout this course.

#### 2.4 Named Options
Multiple distinct configurations of the same options type (`services.Configure<SmtpOptions>("Marketing",...)`, `services.Configure<SmtpOptions>("Transactional",...)`) resolved via `IOptionsMonitor<T>.Get("Marketing")` — lets one options *type* serve multiple independently-configured instances.

### 3. Visual Architecture

```mermaid
graph LR
 A[appsettings.json] --> M[Merged IConfiguration]
 B[appsettings.Production.json] --> M
 C[Environment Variables] --> M
 D[Command-line args] --> M
 M -->|Bind| E["IOptions&lt;T&gt; (once, frozen)"]
 M -->|Bind per-scope| F["IOptionsSnapshot&lt;T&gt; (per request)"]
 M -->|Bind + watch for change| G["IOptionsMonitor&lt;T&gt; (always current)"]
```

### 4. Production Example

**Scenario**: A feature-flag service injected `IOptionsSnapshot<FeatureFlags>` into a `Singleton`-registered background scheduler — this threw `InvalidOperationException` (captive-dependency violation) immediately once `ValidateOnBuild` was enabled organization-wide (the remediation). **Fix**: switched to `IOptionsMonitor<FeatureFlags>`, which is `Singleton`-safe and still reflects live config-file changes via its `.OnChange` hook. **Lesson**: the three options interfaces aren't interchangeable — the choice is a lifetime decision with the exact same captive-dependency stakes as any other DI lifetime choice.

### 11. Coding Exercises

#### Easy — Bind and validate options with `ValidateOnStart`
```csharp
public class SmtpOptions
{
    [Required] public string Host { get; set; } = "";
    [Range(1, 65535)] public int Port { get; set; }
}

builder.Services.AddOptions<SmtpOptions>
.Bind(builder.Configuration.GetSection("Smtp"))
.ValidateDataAnnotations
.ValidateOnStart; // fails the app at startup, not on first email send, if Host/Port are invalid
```
**Discussion**: Without `ValidateOnStart`, a missing `Host` would only surface as an exception the first time `EmailSender` actually tries to connect — potentially hours after a bad deploy, in production, on the first attempted email send.

#### Medium — Named options for per-tenant SMTP configuration
```csharp
foreach (var tenant in builder.Configuration.GetSection("Tenants").GetChildren)
{
    builder.Services.Configure<SmtpOptions>(tenant.Key, tenant.GetSection("Smtp"));
}

public class TenantEmailSender
{
    private readonly IOptionsMonitor<SmtpOptions> _options;
    private readonly ITenantContext _tenantContext;
    public TenantEmailSender(IOptionsMonitor<SmtpOptions> options, ITenantContext tenantContext)
    {
        _options = options; _tenantContext = tenantContext;
    }
    public void Send => Connect(_options.Get(_tenantContext.TenantId).Host);
}
```
**Discussion**: `.Get(name)` — not `.CurrentValue` — is what resolves the named instance; forgetting this and using `.CurrentValue` silently returns the unnamed default configuration instead of the tenant-specific one, a realistic, easy-to-make mistake.

#### Hard — Custom cross-field `IValidateOptions<T>`
```csharp
public class RangeOptions { public int MinValue { get; set; } public int MaxValue { get; set; } }

public class RangeOptionsValidator: IValidateOptions<RangeOptions>
{
    public ValidateOptionsResult Validate(string? name, RangeOptions options)
    {
        if (options.MinValue >= options.MaxValue)
            return ValidateOptionsResult.Fail("MinValue must be less than MaxValue.");
        return ValidateOptionsResult.Success;
    }
}
// Registration: builder.Services.AddSingleton<IValidateOptions<RangeOptions>, RangeOptionsValidator>
```
**Discussion**: Data Annotations (`[Range]`) validate a single property in isolation; `IValidateOptions<T>` is the correct extensibility point for validation logic spanning multiple properties, exactly the same "escalate to a custom mechanism once the built-in convenience methods can't express the rule" pattern seen with `AuthorizationHandler<T>`.

#### Expert — Live-reloading feature flags invalidating a dependent cache atomically
```csharp
public class FeatureFlagCache
{
    private readonly IMemoryCache _cache;
    public FeatureFlagCache(IOptionsMonitor<FeatureFlags> monitor, IMemoryCache cache)
    {
        _cache = cache;
        monitor.OnChange(flags => _cache.Remove("computed-feature-state")); // invalidate on ANY change
    }
}
```
**Discussion**: `OnChange` fires on every reload regardless of whether the *specific* flag a given cache entry depends on actually changed — a coarse but simple and safe invalidation strategy; a more surgical version would diff old vs. new values and invalidate only affected cache keys, a worthwhile refinement to mention if asked to extend this further in an interview.

### 12. System Design
A multi-region platform centralizes configuration via Azure App Configuration, with every replica's `IOptionsMonitor<T>` reacting to changes without redeployment; feature-flag rollouts are staged progressively (5% → 25% → 100% of traffic) using a per-request flag evaluation rather than a binary on/off switch, and every required setting is validated at startup (`ValidateOnStart`) so a bad configuration push fails new replica startup immediately (failing readiness checks) rather than serving with broken configuration.

### 13. Low-Level Design
A small `ITenantOptionsResolver<T>` wrapping `IOptionsMonitor<T>.Get(tenantId)` behind a single-method interface lets consuming services depend on an abstraction rather than remembering to call `.Get(...)` with the correct tenant ID at every call site — directly mirroring the `IResourceAuthorizationHelper` facade pattern, applied here to reduce repetitive, easy-to-get-wrong named-options resolution boilerplate.

### 14. Production Debugging
The signature incident for this module: a `Singleton` capturing `IOptionsSnapshot<T>` — diagnosed identically to any other captive-dependency bug: `ValidateOnBuild` throws at startup, naming the exact offending registration; the fix is switching to `IOptionsMonitor<T>`, not restructuring the consuming service's lifetime.

### 15. Architecture Decision
Centralized, live-reloadable configuration (Azure App Configuration/Consul + `IOptionsMonitor`) is recommended over redeploy-to-change static configuration for any setting that plausibly needs adjustment without a full deployment (feature flags, rate limits, timeout thresholds) — reserving redeploy-required static configuration for settings that are genuinely part of the application's build-time identity (connection strings tied to a specific environment's infrastructure).

### 16. Enterprise Case Study
Large-scale feature-flag platforms (LaunchDarkly, Azure App Configuration's feature-management integration) are, architecturally, a specialized, externally-hosted implementation of exactly this module's `IOptionsMonitor`-based live-reload pattern — recognizing this parallel helps explain *why* a third-party feature-flag service integrates so naturally with `IOptionsMonitor<T>`-consuming code: it's solving the identical "Singleton-safe, always-current, reactively-updatable configuration" problem this module covers, just with a richer targeting/rollout UI layered on top.

### 17. Principal Engineer Perspective
Treat options-interface choice with the same lifetime rigor as any other DI decision — this module's captive-dependency bug class is not a separate concern, it's the identical bug wearing configuration-specific clothing. Mandate `ValidateOnStart` for all required configuration organization-wide, converting configuration mistakes into startup failures caught in CI/staging rather than production runtime surprises.

### 18. Revision

**Key takeaways**: `IOptions` = frozen once; `IOptionsSnapshot` = per-scope, not Singleton-safe; `IOptionsMonitor` = always-current, Singleton-safe. `ValidateOnStart` converts runtime configuration failures into startup failures. Configuration source precedence: later-added source wins.

**Cross-reference**: [[02-DI-Container-Internals]]/§Advanced Q6 for the lifetime rules this module's options-interface choice directly inherits.

---

**Next**: Continuing autonomously to Module 14 — Health Checks & Observability Integration, then advancing toward `03-REST-APIs`.
