# 16. API Security / OWASP — 25 Questions (Answered)

> **Method:** risk definitions are quoted from the **OWASP API Security Top 10 (2023)** and the **OWASP Top 10** for web risks, with the **OWASP Cheat Sheet Series** for the prevention guidance; .NET implementation from **Microsoft Learn** (ASP.NET Core security, EF Core, model binding); cloud controls from **AWS** (WAF, API Gateway, Well-Architected Security pillar); and the relevant **IETF RFCs** for HTTP and token semantics. Several web-level vulnerabilities are covered generally in **Module 15** — here the emphasis is the **API-specific** angle. Links in **References**.

---

## Q1. What is OWASP?

The **Open Worldwide Application Security Project** is a non-profit foundation that produces free, community-driven, vendor-neutral security guidance, tooling and standards for software. Its material is the de facto reference for application security and is cited directly in **PCI DSS**, and by regulators and auditors as the expected baseline.

**What an architect actually uses from OWASP:**

| Resource | Use |
|---|---|
| **OWASP Top 10** | The ten most critical **web application** security risks; the baseline every developer is expected to know |
| **OWASP API Security Top 10** | The equivalent for **APIs** — a separate list because API risks differ (Q2) |
| **Cheat Sheet Series** | The practical prevention guidance: concrete, per-topic, implementation-level. **The most useful thing OWASP publishes** |
| **ASVS** (Application Security Verification Standard) | A tiered, testable requirements catalogue — what you actually write into a security specification or a supplier contract |
| **SAMM** | A maturity model for building a security programme |
| **Dependency-Check / dependency-track** | Supply-chain scanning |
| **ZAP** | An open-source dynamic scanner, usable in CI |
| **Top 10 for LLM Applications** | The newer list covering prompt injection, insecure output handling and the rest (Module 19) |

**The distinction worth making in an interview:** the **Top 10 is an awareness document**, not a standard — it lists common risk categories, and passing it does not mean an application is secure. **ASVS is the standard**: it enumerates verifiable requirements at three levels, so you can state "this system meets ASVS Level 2" and have that mean something testable. Saying that shows you have used OWASP as an engineering input rather than a poster on the wall.

**Why it matters commercially:** PCI DSS requires developers to be trained in secure coding covering, at minimum, the OWASP Top 10; penetration-test reports are structured around it; and in a bank, "we follow OWASP guidance" is a claim you will be asked to evidence.

---

## Q2. What is OWASP API Security Top 10?

A separate top-ten list, first published in 2019 and revised in **2023**, because **API risks are materially different from traditional web-application risks**: APIs expose object identifiers directly, have no server-rendered UI to hide business logic behind, are consumed by clients you do not control, and are far more numerous and more easily forgotten.

**The 2023 list, with OWASP's own descriptions:**

| ID | Risk | OWASP's description |
|---|---|---|
| **API1** | **Broken Object Level Authorization (BOLA)** | *"APIs tend to expose endpoints that handle object identifiers, creating a wide attack surface"* of access-control issues |
| **API2** | **Broken Authentication** | *"Authentication mechanisms are often implemented incorrectly, allowing attackers to compromise authentication tokens"* or assume other identities |
| **API3** | **Broken Object Property Level Authorization** | *"Lack of or improper authorization validation at the object property level"* — combines excessive data exposure and mass assignment |
| **API4** | **Unrestricted Resource Consumption** | Attacks can trigger *"Denial of Service or an increase of operational costs"* |
| **API5** | **Broken Function Level Authorization** | *"Complex access control policies with different hierarchies, groups, and roles"* lead to exploitable flaws |
| **API6** | **Unrestricted Access to Sensitive Business Flows** | Business operations exposed *"without compensating for how the functionality could harm the business if used excessively"* |
| **API7** | **Server Side Request Forgery** | *"SSRF flaws occur when an API is fetching a remote resource without validating the user-supplied URI"* |
| **API8** | **Security Misconfiguration** | Engineers *"miss these configurations, or don't follow security best practices"* |
| **API9** | **Improper Inventory Management** | *"APIs tend to expose more endpoints than traditional web applications"*, requiring documentation and tracking |
| **API10** | **Unsafe Consumption of APIs** | Developers *"trust data received from third-party APIs more than user input"* |

**The pattern to point out, because it is the insight rather than the list:** **five of the ten are authorization failures** (API1, API3, API5, plus API6 which is business-logic authorization, and much of API2). **Authorization — not authentication, not injection — is the dominant API risk class.** That is because authentication is largely solved and centralised (delegate to an IdP), while authorization is domain-specific, must be written per endpoint and per object, and is therefore where the mistakes are.

**The second observation worth making:** API9 (inventory) and API10 (unsafe consumption) are about **governance and trust boundaries**, not code. Forgotten `v1` endpoints still serving production data, an undocumented internal API exposed to the internet, a staging environment with real data — these are architecture and process failures, and they are how large breaches actually begin.

---

## Q3. How do you prevent Broken Object Level Authorization?

**BOLA (API1) is the number-one API risk**, and it is disarmingly simple: the API checks that you are **authenticated**, and that you may call **this endpoint**, but never checks that you may access **this specific object**.

```http
GET /api/payments/9f3a2c        ← my payment.        200 OK ✓
GET /api/payments/9f3a2d        ← someone else's.    200 OK ✗ BOLA
```
The identifier is in the URL and the attacker simply changes it. Sequential IDs make it trivially enumerable; UUIDs make it slower but **are not a fix** — obscurity is not authorization, and identifiers leak through exports, emails, referrer headers and support tickets.

**The fix — enforce ownership/tenancy at the data layer, on every access:**

```csharp
// ✗ VULNERABLE — authenticated, but no object-level check
app.MapGet("/api/payments/{id}", async (string id, IPaymentRepository repo) =>
    Results.Ok(await repo.GetAsync(id))).RequireAuthorization();

// ✓ CORRECT — the tenant is part of the QUERY, not a post-hoc check
app.MapGet("/api/payments/{id}", async (string id, ClaimsPrincipal user, IPaymentRepository repo) =>
{
    var tenantId = user.FindFirstValue("tenant")
                   ?? throw new InvalidOperationException("Missing tenant claim");

    var payment = await repo.GetForTenantAsync(id, tenantId);   // WHERE id=@id AND tenant=@t
    return payment is null ? Results.NotFound() : Results.Ok(payment);
}).RequireAuthorization();
```

**The techniques, in order of robustness:**

1. **Scope the query, don't filter the result.** `WHERE id = @id AND tenant_id = @tenant` is far safer than fetching then comparing, because there is no path where a developer forgets the second step.
2. **Enforce it centrally so it cannot be forgotten.** An EF Core **global query filter** applies the tenant predicate to every query for that entity:
   ```csharp
   modelBuilder.Entity<Payment>().HasQueryFilter(p => p.TenantId == _tenantContext.TenantId);
   ```
   Or **PostgreSQL Row-Level Security**, which enforces it in the database itself — so even a raw SQL query or a compromised service cannot bypass it. In a multi-tenant financial system, RLS is the strongest available answer.
3. **Resource-based authorization** for rules more complex than ownership (Module 15 Q20): `await _authz.AuthorizeAsync(user, payment, "CanViewPayment")`.
4. **Return `404`, not `403`, for objects the caller may not see.** A `403` confirms the object exists, which is an enumeration oracle.
5. **Use unpredictable identifiers** (UUIDv7, ULID) as defence in depth — never as the control.
6. **Test for it.** An automated test per endpoint: authenticate as tenant A, request tenant B's object, assert 404. This is cheap, catches regressions, and almost nobody does it.

**Why it is so common:** the check must be written **per endpoint, per object type, per access path** — including bulk endpoints, exports, search, webhooks and admin tooling. A single missed path is a full data breach, and no framework does it for you by default.

---

## Q4. What is Broken Authentication?

**Per OWASP (API2:2023):** *"Authentication mechanisms are often implemented incorrectly, allowing attackers to compromise authentication tokens"* or assume other identities. It is second on the list because a failure here is total: the attacker becomes another user.

**The failure modes, and how each is fixed:**

| Failure | Fix |
|---|---|
| **Weak or missing token validation** — not checking signature, `iss`, `aud` or `exp` | The full validation checklist (Module 15 Q7); pin the algorithm |
| **Accepting `alg: none` or algorithm confusion** | Pin `ValidAlgorithms`; never let the token choose |
| **No brute-force protection** on login, OTP or token endpoints | Rate limiting + progressive delay + account lockout (Q18) |
| **Credential stuffing** | MFA, breached-password checks, device fingerprinting, bot detection |
| **Weak password policy** | NIST SP 800-63B: length over complexity, check against breach corpora, no forced rotation without cause |
| **Tokens in URLs** | They land in logs, proxies, browser history and `Referer` headers. **Always `Authorization` header** |
| **Long-lived or non-expiring tokens** | Short access-token lifetime + rotated refresh tokens |
| **No revocation path** | Refresh-token rotation with reuse detection; `jti` denylist where warranted |
| **Missing authentication on some endpoints** | An authorization **`FallbackPolicy`** so endpoints fail closed by default |
| **Weak account recovery** | Password reset is an authentication path — it needs the same rigour, plus short-lived single-use tokens |
| **API keys used as authentication** | Keys identify a *client*, not a user; they are long-lived and frequently leaked. Prefer OAuth with short-lived tokens |

**The two API-specific traps worth naming:**

1. **Inconsistent enforcement across an estate.** A new controller ships without `[Authorize]`; a `v1` endpoint retained for a legacy client never got the new validation; an internal service exposed through the gateway by accident. The systemic fix is a **secure-by-default posture** — a fallback policy in code, and a gateway that refuses to route to an endpoint without an auth policy — not developer discipline.
2. **Different services validating differently.** Twelve services each configuring `AddJwtBearer` slightly differently, one with `ValidateAudience = false`. Fix by shipping a **shared, versioned authentication package** with the correct defaults, so the secure configuration is the path of least resistance.

**In a fintech context, add:** phishing-resistant MFA (FIDO2/WebAuthn) for staff, **step-up authentication** for high-value operations, sender-constrained tokens (mTLS-bound, per FAPI — Module 15 Q9), and an audit record of every authentication event, success or failure.

---

## Q5. How do you prevent excessive data exposure?

**Per OWASP, this is now part of API3:2023 — Broken Object Property Level Authorization**, which combines **excessive data exposure** (returning more properties than the caller should see) with **mass assignment** (accepting more properties than the caller should set). Both are the same root cause: **no authorization at the property level**.

**Excessive data exposure — returning the entity instead of a view:**

```csharp
// ✗ VULNERABLE — returns EVERY property, and any property added later
app.MapGet("/api/customers/{id}", async (int id, AppDbContext db) =>
    Results.Ok(await db.Customers.FindAsync(id)));
// → { id, name, email, passwordHash, internalRiskScore, ssn, notes, ... }
```
The UI happens to display three fields, so nobody notices — until someone opens the network tab. **The API is the contract; the client's rendering is not a security control.**

```csharp
// ✓ CORRECT — an explicit, minimal response DTO
public sealed record CustomerDto(int Id, string Name, string MaskedEmail);

app.MapGet("/api/customers/{id}", async (int id, AppDbContext db) =>
    await db.Customers.Where(c => c.Id == id)
        .Select(c => new CustomerDto(c.Id, c.Name, Mask(c.Email)))   // projected in SQL
        .FirstOrDefaultAsync() is { } dto ? Results.Ok(dto) : Results.NotFound());
```
Projecting into the DTO in the query also means the sensitive columns are **never read from the database at all** — a performance win and a security win together (Module 11 Q10).

**Mass assignment — accepting properties the caller should not set:**

```csharp
// ✗ VULNERABLE — binds every property on the entity
app.MapPut("/api/customers/{id}", async (int id, Customer input, AppDbContext db) => { … });
// Attacker sends: { "name": "X", "isAdmin": true, "creditLimit": 1000000 }

// ✓ CORRECT — an explicit request DTO containing ONLY what may be set
public sealed record UpdateCustomerRequest(string Name, string Email);
```

**The rules:**
1. **Never bind or return domain entities directly.** Explicit request and response DTOs, always. This single rule prevents both halves of API3.
2. **Allow-list properties**, never deny-list — a deny-list silently fails the moment someone adds a property.
3. **Property-level authorization where it varies by role**: an operator sees a masked account number, a compliance officer sees it in full. Shape the DTO by role rather than returning everything and hiding it client-side.
4. **Mask or tokenise by default** — PAN, IBAN, national identifiers.
5. **Test it**: assert on the exact response shape, so adding a property to an entity does not silently leak it. A contract test that fails when a new field appears is exactly what you want.

---

## Q6. How do you prevent unrestricted resource consumption?

**Per OWASP (API4:2023):** API requests consume resources such as bandwidth, CPU, memory and storage, and attacks can trigger *"Denial of Service or an increase of operational costs."* The cost dimension is what makes this different from classic DoS — in a cloud/serverless architecture, an attacker does not need to take you down to hurt you; **they can simply make you spend money**.

**The limits to enforce, and each one is a specific attack closed:**

| Limit | Prevents |
|---|---|
| **Rate limits** per client/user/tenant/IP | Volumetric abuse, brute force (Q17) |
| **Concurrency limits** | Resource exhaustion at low request rates |
| **Request body size** (`MaxRequestBodySize`) | Memory exhaustion via a giant payload |
| **Pagination with a MAX page size** | `?limit=1000000` returning the whole table |
| **Array/collection length caps** in request models | A bulk endpoint given 100,000 items |
| **Query complexity limits / depth limits** (GraphQL) | Deeply nested queries with exponential cost |
| **Timeouts** on every operation, inbound and outbound | Slowloris; a hung downstream holding threads |
| **File upload size and type limits** | Storage exhaustion (Q22) |
| **Regex timeouts** | **ReDoS** — catastrophic backtracking. `new Regex(pattern, options, TimeSpan.FromMilliseconds(200))` |
| **Spending caps and budget alarms** | Cost-based abuse of metered downstreams (SMS, KYC, LLM APIs) |
| **Quotas** per partner per day/month | Sustained over-consumption within the rate limit |

```csharp
// Pagination with a hard ceiling — a one-line fix for a very common issue
public sealed record PageRequest(int Page = 1, int Size = 25)
{
    public int Size { get; init; } = Math.Clamp(Size, 1, 100);   // MAX 100, always
}

// Request size limits
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = 1_048_576);   // 1 MB
```

**The economic angle to raise, because it is what an architect is paid to notice:** on Lambda, DynamoDB on-demand, API Gateway or an LLM endpoint, every request has a direct marginal cost. An attacker who cannot take you down can still generate a five-figure bill overnight. **Rate limits and quotas are therefore a financial control as well as a security one**, and budget alarms belong in the same design discussion.

**Layer the enforcement:** WAF rate-based rules and API Gateway throttling at the edge (rejecting there is cheapest), plus application-level limits for business rules the gateway cannot express, plus infrastructure limits (container memory limits, connection pool caps) as the final backstop.

---

## Q7. How do you protect APIs from injection attacks?

**Injection** is the class where untrusted input is interpreted as **code or commands** by an interpreter. SQL is the famous case, but the principle is identical across every interpreter.

| Injection type | Interpreter | Defence |
|---|---|---|
| **SQL** | The database | **Parameterised queries** (Q10–Q12) |
| **NoSQL** | MongoDB, DynamoDB | Typed queries; never build a query object from raw JSON; reject `$`-prefixed keys |
| **Command** | The OS shell | **Do not shell out.** If unavoidable: `ProcessStartInfo` with an argument **array**, never a concatenated command line, plus an allow-list |
| **LDAP** | The directory | LDAP-encode; use parameterised filters |
| **XPath / XML (XXE)** | The XML parser | **Disable DTD processing and external entity resolution** — `XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null }` |
| **Header / log injection (CRLF)** | HTTP, the log pipeline | Strip `\r\n` from anything user-supplied that reaches a header or a log line |
| **Template injection** | Razor, Liquid, Handlebars | Never build a template from user input |
| **Expression / deserialisation** | `BinaryFormatter`, `TypeNameHandling` | **Never deserialise untrusted data with type-resolving serialisers.** `BinaryFormatter` is obsolete and removed in .NET 9 for exactly this reason |
| **Prompt injection** | An LLM | Treat model input as untrusted; constrain tools and outputs (Module 19) |

**The single principle that covers all of them:** *separate code from data.* Every safe mechanism above does the same thing — it hands the interpreter the **structure** and the **values** through different channels, so a value can never be reinterpreted as structure. Parameterised queries, argument arrays, encoded LDAP filters and prepared statements are all instances of that one idea.

**Layered practice for an API:**
1. **Parameterise / use safe APIs** — the actual fix.
2. **Validate input with an allow-list** where the format is known (a currency code is exactly three uppercase letters). Secondary control, not the fix.
3. **Least-privilege data access** — the application's database user should not be `db_owner` and should not be able to `DROP`.
4. **Output encoding** for the destination context (Module 15 Q28).
5. **Generic error responses**, so a failed injection attempt does not return schema details (Q20).
6. **Detection**: alert on SQL/parse errors — they spike sharply during an injection attempt, which is one of the most reliable early signals available.
7. **SAST/DAST in CI**, plus a WAF as a slowing and detection layer — never as the remediation.

---

## Q8. How do you prevent SSRF?

**Per OWASP (API7:2023):** *"SSRF flaws occur when an API is fetching a remote resource without validating the user-supplied URI."* Module 15 Q30 covers the mechanics; here is the API-specific prevention, because API features are exactly where SSRF lives.

**Where APIs create SSRF exposure:** webhook registration (the customer supplies a callback URL), "import from URL", document/PDF rendering from a link, image fetch-and-thumbnail, link previews, SSO metadata URLs, XML parsers resolving external entities, and any integration where a URL is a configuration value.

**The defence, in order:**

1. **Allow-list destinations.** The only robust application-level control. Deny-lists fail against DNS rebinding, redirects, IPv6-mapped addresses (`[::ffff:169.254.169.254]`), decimal/octal IP encodings, and `@`-embedded credentials.
2. **Resolve → validate → pin.** Resolve the hostname, reject private/link-local/loopback/multicast ranges, then **connect to the resolved IP** you validated. Otherwise DNS rebinding swaps the answer between the check and the connection.
   ```csharp
   var addresses = await Dns.GetHostAddressesAsync(uri.Host);
   if (addresses.Any(IsPrivateOrLinkLocal)) throw new SecurityException("Blocked destination");
   ```
3. **Disable automatic redirect following**, or re-validate every hop — an allowed URL that 302s to the metadata service defeats a naive check.
   ```csharp
   new HttpClientHandler { AllowAutoRedirect = false }
   ```
4. **Restrict schemes to HTTPS**; block `file://`, `gopher://`, `ftp://`, `dict://`.
5. **Block IMDS from the workload.** IMDSv2 with hop limit 1, and on EKS block pod access to `169.254.169.254` entirely (Module 10 Q27). **The highest-value cloud mitigation**, because it removes the prize.
6. **Egress network control.** The service can only reach the hosts it needs — Network Firewall with domain filtering, a NetworkPolicy egress rule, or an outbound proxy with an allow-list. This is what contains SSRF when the application-level check fails.
7. **Timeouts and response size limits** on the fetch, and **do not return the raw response to the caller** — returning it turns blind SSRF into full data exfiltration.
8. **Isolate the fetching component**, ideally in a separate account/VPC with no IAM permissions and no route to internal networks.

**Design principle:** *treat any user-supplied URL as an instruction to make a request from inside your network, because that is exactly what it is.* Then design the network position of the fetching component accordingly.

---

## Q9. How do you validate input?

**Validate at the boundary, with an allow-list, against an explicit schema — and treat validation as a correctness control that also happens to help security, not as the security control itself.**

**The layers:**

| Layer | What it checks |
|---|---|
| **Syntactic** | Type, format, length, range, pattern, required/optional |
| **Semantic** | Business rules — is this currency supported? Is this account active? Is the amount within the merchant's limit? |
| **Contextual** | Does this make sense for this caller, in this state, at this time? |

**In ASP.NET Core:**
```csharp
public sealed record CreatePaymentRequest(
    [Required, StringLength(64, MinimumLength = 1)] string MerchantReference,
    [Range(1, 100_000_00)]                          long   AmountMinorUnits,
    [Required, RegularExpression("^[A-Z]{3}$")]     string Currency);

// Or FluentValidation for anything expressive
public sealed class CreatePaymentValidator : AbstractValidator<CreatePaymentRequest>
{
    public CreatePaymentValidator(ICurrencyCatalogue currencies)
    {
        RuleFor(x => x.Currency).Must(currencies.IsSupported)      // allow-list
            .WithMessage("Unsupported currency");
        RuleFor(x => x.AmountMinorUnits).GreaterThan(0);
    }
}
```

**The rules that matter:**

1. **Allow-list, never deny-list.** Define what is *valid* and reject everything else. A deny-list is an incomplete enumeration of attacks, and it is always out of date.
2. **Validate at every trust boundary**, including between internal services — do not assume the caller sanitised anything (Module 15 Q21).
3. **Use strong types.** `record CreatePaymentRequest(long AmountMinorUnits, ...)` with a `Currency` value object rejects a whole class of input before any validator runs. **Parse, don't validate** — convert untrusted input into a type that cannot hold an invalid value.
4. **Money is `long` minor units or `decimal`, never `double`.** A float rounding error in a payment API is a defect, not a rounding artefact.
5. **Reject, don't sanitise, by default.** Silently "cleaning" input produces surprising behaviour and often reintroduces the flaw. Sanitisation is appropriate only for rich text you must render, and then with a vetted library.
6. **Validation is not output encoding.** The same string can be valid input and dangerous output; encode at the point of output, for that context (Module 15 Q28).
7. **Bound everything**: string lengths, array sizes, object depth, request size, numeric ranges. Unbounded input is API4 (Q6).
8. **Return `400` with a structured problem detail** listing the field errors — helpful without revealing internals (Q20).

**And validate the *envelope*, not just the body:** headers, content type (reject unexpected types explicitly), HTTP method, and path parameters. A `Content-Type` you did not expect reaching a permissive parser is how deserialisation bugs get triggered.

---

## Q10. How do you prevent SQL Injection in .NET?

**Parameterise everything.** Module 15 Q29 covers the vulnerability; this is the .NET-specific answer.

```csharp
// ✓ ADO.NET — explicit parameters, with type and size
await using var cmd = conn.CreateCommand();
cmd.CommandText = "SELECT * FROM payments WHERE merchant_id = @m AND status = @s";
cmd.Parameters.Add("@m", SqlDbType.NVarChar, 64).Value = merchantId;
cmd.Parameters.Add("@s", SqlDbType.NVarChar, 16).Value = status;

// ✓ Dapper — anonymous object becomes parameters
await conn.QueryAsync<Payment>(
    "SELECT * FROM payments WHERE merchant_id = @merchantId", new { merchantId });

// ✓ EF Core LINQ — always parameterised
await ctx.Payments.Where(p => p.MerchantId == merchantId).ToListAsync();

// ✓ EF Core FromSql with an interpolated string — SAFE: EF converts holes to parameters
await ctx.Payments.FromSql($"SELECT * FROM payments WHERE merchant_id = {merchantId}")
                  .ToListAsync();

// ✗ FromSqlRaw with concatenation — NOT safe
await ctx.Payments.FromSqlRaw("SELECT * FROM payments WHERE merchant_id = '" + merchantId + "'")
                  .ToListAsync();
```

**The `FromSql` vs `FromSqlRaw` distinction is a favourite interview detail** and worth stating precisely: `FromSql`/`ExecuteSql` take a `FormattableString` and parameterise every interpolation hole. `FromSqlRaw`/`ExecuteSqlRaw` take a plain `string` and do exactly what you tell them — so concatenation there is a vulnerability. If you use the `Raw` variants, pass parameters explicitly:
```csharp
await ctx.Payments.FromSqlRaw("SELECT * FROM payments WHERE merchant_id = {0}", merchantId)
                  .ToListAsync();
```

**What parameters cannot protect, and this is the part that catches people:** **identifiers are not parameterisable.** Dynamic column names, table names, `ORDER BY` direction — these must be validated against an allow-list:
```csharp
static readonly string[] Sortable = ["created_at", "amount", "status"];
if (!Sortable.Contains(sortBy)) throw new ArgumentException(nameof(sortBy));
var dir = descending ? "DESC" : "ASC";                     // never take this from input
var sql = $"SELECT * FROM payments ORDER BY {sortBy} {dir}";   // now safe: values are vetted
```

**Defence in depth beyond parameterisation:** a least-privilege database login (the app user should not own the schema); no dynamic SQL inside stored procedures unless it too parameterises; generic error messages so a failed attempt reveals nothing (Q20); **Row-Level Security** as a second gate for tenancy (Q3); SAST rules that fail the build on string-concatenated SQL; and alerting on SQL error-rate spikes.

---

## Q11. Parameterised query vs string concatenation?

**They differ in how the database receives the query, and that difference is why one is safe and the other is not.**

```csharp
// Concatenation — ONE string is sent; the database parses value and code together
var sql = "SELECT * FROM users WHERE email = '" + email + "'";
// email = "' OR 1=1 --"  →  SELECT * FROM users WHERE email = '' OR 1=1 --'
//                            └─ the input became SQL SYNTAX

// Parameterised — the query TEXT and the VALUES travel separately
cmd.CommandText = "SELECT * FROM users WHERE email = @email";
cmd.Parameters.Add("@email", SqlDbType.NVarChar, 256).Value = email;
// The database parses the statement first, THEN binds @email as a VALUE.
// It is impossible for the value to be reinterpreted as syntax.
```

**The mechanism, stated precisely:** with a parameterised command the client sends the statement text and a separate list of typed parameters. The server parses and plans the statement **before** the values are bound, so the parse tree is fixed and no value can alter it. With concatenation, the value is part of the text at parse time, so it *can* alter the parse tree — which is the vulnerability.

**Three benefits beyond security, worth mentioning because they make parameterisation the default for reasons other than fear:**

| Benefit | Detail |
|---|---|
| **Plan reuse** | The same statement text with different parameters reuses the cached execution plan. Concatenation produces a distinct statement per value, **bloating the plan cache and forcing a compile per request** — a real performance problem at scale |
| **Type correctness** | Parameters carry explicit types, avoiding implicit conversions that silently defeat indexes (`CONVERT_IMPLICIT`, Module 11 Q14) |
| **Culture and format safety** | Dates, decimals and negative numbers are transmitted in binary/typed form, not formatted into a string where a locale difference becomes a bug |

**Specify the parameter size**, especially for `NVarChar`. Omitting it makes the length vary with the supplied value, which produces a *different* plan-cache entry per length — a subtle and well-documented performance issue in SQL Server.

**The rule to state:** *never build SQL by concatenating anything that is not a compile-time constant.* If a value must be dynamic, it is a parameter. If an **identifier** must be dynamic, it comes from an allow-list. There is no third case.

---

## Q12. How does Entity Framework protect against SQL injection?

**EF Core parameterises everything it generates.** Any value in a LINQ query becomes a SQL parameter, never inlined text.

```csharp
await ctx.Payments.Where(p => p.MerchantId == merchantId && p.Amount > min).ToListAsync();
```
generates:
```sql
SELECT p.* FROM payments AS p
WHERE p.merchant_id = @__merchantId_0 AND p.amount > @__min_1
```

**Why it is safe by construction:** LINQ is an **expression tree**, not a string. EF's query pipeline translates the tree into SQL, and the leaves that came from variables are emitted as parameters — there is no code path in which a user value is concatenated into the statement text. The safety is structural rather than a filter that could be bypassed.

**This holds for:** `Where`, `Select`, `OrderBy`, `Join`, `Contains` (which becomes an `IN` with parameters, or a table-valued parameter for large lists), `ExecuteUpdate`/`ExecuteDelete`, and `SaveChanges`.

**Where EF does *not* protect you — and this is the substance of the answer:**

| Risk | Detail |
|---|---|
| **`FromSqlRaw` / `ExecuteSqlRaw` with concatenation** | You supplied the string; EF passes it through (Q10) |
| **Dynamic identifiers** built into raw SQL | Column/table names cannot be parameterised — allow-list them |
| **`EF.Functions.Like` with an unescaped pattern** | Not injection, but a user-supplied `%` at the start forces a scan and can be a DoS vector |
| **Stored procedures that build dynamic SQL internally** | EF calls them safely; the vulnerability is inside the procedure |
| **Everything else in the OWASP list** | EF prevents SQLi. It does nothing about BOLA, mass assignment, over-exposure, rate limits or authorization |

**The point I would make to a panel:** EF Core removes SQL injection as a practical concern *for LINQ queries*, which is genuinely valuable — but it can create a false sense of security. **The most common serious flaws in an EF-based API are authorization flaws (BOLA, mass assignment), not injection**, and those are precisely the ones the ORM cannot help with. Use EF's global query filters and resource-based authorization to address them (Q3, Q5), and keep the SAST rule that flags `FromSqlRaw` with concatenation, because that is the one path back to the classic vulnerability.

---

## Q13. What is XSS and how do you prevent it?

Module 15 Q28 covers XSS in full. The **API-specific** angle, which is what this question is really asking:

**Is XSS an API concern at all?** A JSON API does not render HTML, so it cannot execute script itself. But it participates in XSS in four ways:

1. **It stores the payload.** Stored XSS is usually *delivered* by an API — a merchant name, a comment, a profile field accepted by the API and later rendered by a front end. The API is the injection point even though the browser is the victim.
2. **Content-type confusion.** If a response is served with `Content-Type: text/html` (or none, letting the browser sniff), a JSON body containing `<script>` can execute. **Always set `Content-Type: application/json`** and send **`X-Content-Type-Options: nosniff`** so browsers do not guess.
3. **Reflected input in error messages.** An error that echoes the input, rendered anywhere, is a reflected XSS vector. Never reflect raw input.
4. **JSONP and callback parameters** — a legacy pattern that is script injection by design. Do not use it; use CORS.

**What the API should do:**

```csharp
app.Use(async (ctx, next) =>
{
    ctx.Response.Headers["X-Content-Type-Options"] = "nosniff";
    ctx.Response.Headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'";
    await next();
});
```
A **`default-src 'none'`** CSP on a pure JSON API is appropriate and costs nothing — the API never legitimately loads resources.

**What the API should *not* do:** try to strip `<script>` from stored data. That is a deny-list, it is bypassable, and it corrupts legitimate data (a merchant genuinely named `Smith & Sons <UK>` is not an attack). **Store data faithfully; encode at output, in the rendering context.** That division of responsibility — API stores, front end encodes — is the correct architecture, and stating it clearly is what distinguishes a good answer.

**Where the API must sanitise:** when it accepts **rich HTML** that will be rendered (a merchant description with formatting). Then sanitise on **input** with a vetted library (`HtmlSanitizer` in .NET), because the front end cannot safely render arbitrary HTML at all.

**And the token-storage link:** the reason XSS is catastrophic for an API-backed SPA is that it can read tokens from `localStorage`. Keep tokens out of JavaScript-accessible storage — HttpOnly cookies via a **BFF** (Module 12 Q14) — and an XSS becomes serious rather than fatal.

---

## Q14. What is CSRF and how do you prevent it?

Module 15 Q27 covers the mechanics. For APIs the essential question is **when it applies**, which Q15 addresses; here is the prevention set.

**CSRF requires ambient authority** — credentials the browser attaches **automatically**: session cookies, HTTP Basic, Windows/NTLM authentication, or a client certificate. If the credential must be added explicitly by JavaScript, cross-site requests cannot carry it.

**Defences, in priority order:**

| Defence | Detail |
|---|---|
| **`SameSite` cookies** | `SameSite=Lax` (the modern browser default) blocks cookies on cross-site POST; use `Strict` for the most sensitive session cookies. **The highest-value single mitigation** |
| **Anti-forgery token** | A per-session unpredictable token sent in a header (`X-CSRF-TOKEN`) or form field and validated server-side. The attacker cannot read it because the same-origin policy prevents cross-origin reads |
| **Double-submit cookie** | Token in both a cookie and a header, compared server-side — stateless, useful for APIs |
| **`Origin` / `Referer` validation** | Reject state-changing requests whose `Origin` is not an allowed value. Simple, effective defence in depth for APIs |
| **Custom header requirement** | Requiring e.g. `X-Requested-With` forces a CORS preflight for cross-origin callers, which your CORS policy then denies. A pragmatic API-level control |
| **No state change on GET** | A `GET` that changes state is exploitable with an `<img>` tag |
| **Re-authentication / transaction signing** | For high-value operations — what a bank actually relies on |

**In ASP.NET Core:**
```csharp
builder.Services.AddAntiforgery(o => o.HeaderName = "X-CSRF-TOKEN");

// Cookie-authenticated apps: make it opt-out rather than opt-in
builder.Services.AddControllers(o => o.Filters.Add(new AutoValidateAntiforgeryTokenAttribute()));

builder.Services.ConfigureApplicationCookie(o =>
{
    o.Cookie.HttpOnly = true;
    o.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    o.Cookie.SameSite = SameSiteMode.Lax;      // Strict where the UX allows
});
```

**The interaction to state:** **XSS defeats every CSRF defence** — script on your origin can read the anti-forgery token and issue same-origin requests. So CSRF protection is meaningful only on top of solid XSS prevention (Q13). And **CORS is not CSRF protection**: a CSRF attack often does not need to read the response, only to cause the side effect, and simple form posts are not blocked by CORS at all.

---

## Q15. When is CSRF relevant for APIs?

**Only when the browser attaches credentials automatically.** This is the discriminating question, and getting it right demonstrates you understand the mechanism rather than the checklist.

| Authentication mechanism | CSRF applicable? | Why |
|---|---|---|
| **Session cookie** | ✅ **Yes** | The browser sends it on cross-site requests automatically |
| **HTTP Basic / Digest** | ✅ Yes | Browser-cached and auto-sent |
| **Windows / NTLM / Kerberos** | ✅ Yes | Auto-negotiated — a classic intranet CSRF case |
| **Client TLS certificate** | ✅ Yes | Auto-presented by the browser |
| **`Authorization: Bearer <token>`** added by JS | ❌ **No** | The attacker's page cannot add the header; and adding a custom header forces a CORS preflight the API refuses |
| **Custom header with a token from `localStorage`** | ❌ No | Same reason |
| **Non-browser client** (server-to-server, mobile, CLI) | ❌ No | There is no ambient browser context to forge from |

**So the practical rule:** *a pure token-authenticated API consumed by a mobile app or a server is not vulnerable to CSRF. A cookie-authenticated API consumed by a browser is.*

**The case that catches people out — the BFF.** The current recommended SPA architecture keeps tokens server-side and authenticates the browser with an **HttpOnly session cookie** (Module 12 Q14, Module 15 Q6). That design eliminates token theft via XSS, but **it reintroduces CSRF**, because the cookie is now ambient authority. So a BFF must implement CSRF protection: `SameSite=Lax`/`Strict`, an anti-forgery token, and `Origin` validation. Trading one risk for another and then failing to mitigate the new one is a common real-world mistake, and naming it is a strong signal.

**Two further nuances:**
- **`SameSite=Lax` is now the browser default**, which mitigates a great deal of historical CSRF — but do not rely on it alone: it does not cover top-level `GET` navigations (hence "no state change on GET"), older browsers exist, and `SameSite=None` (required for genuine cross-site cookie use) removes the protection entirely.
- **Simple cross-origin POSTs are not blocked by CORS.** A form POST with `Content-Type: application/x-www-form-urlencoded` is a "simple request" — no preflight, so CORS never gets a say. Requiring `application/json` **and** rejecting other content types is therefore a meaningful control, because a JSON content type triggers a preflight.

---

## Q16. What is CORS and why does it matter?

Module 15 Q26 covers the mechanism. The **API-relevant** points:

**Why it matters for an API:** CORS is the mechanism by which you decide **which browser-based origins may call your API and read the responses**. Get it wrong in the permissive direction and any website can make authenticated requests as your logged-in users; get it wrong in the restrictive direction and your own front end breaks.

**The dangerous misconfigurations, in order of severity:**

| Misconfiguration | Consequence |
|---|---|
| **Reflecting the `Origin` header** with `Allow-Credentials: true` | **Effectively allows every origin with credentials.** Any site can make authenticated cross-origin calls as your user and read the responses. The worst CORS bug, and a common one |
| `AllowAnyOrigin()` + `AllowCredentials()` | Browsers reject the combination — and ASP.NET Core throws — but people work around it with reflection, arriving at the row above |
| **Overly broad origin patterns** (`*.example.com` matching a subdomain an attacker controls) | Subdomain takeover becomes full API access |
| **`null` origin allowed** | Sandboxed iframes and some local files send `Origin: null` |
| **No `Vary: Origin`** on a cached response | A CDN can serve one origin's `Access-Control-Allow-Origin` to another |

**Correct configuration:**
```csharp
builder.Services.AddCors(o => o.AddPolicy("app", p => p
    .WithOrigins("https://app.example.com", "https://admin.example.com")  // explicit list
    .WithMethods("GET", "POST", "PUT", "DELETE")
    .WithHeaders("Authorization", "Content-Type", "X-CSRF-TOKEN")
    .AllowCredentials()
    .SetPreflightMaxAge(TimeSpan.FromMinutes(10))));   // cache preflights — halves request count

app.UseCors("app");   // before UseAuthorization
```

**The three things to say that show real understanding:**

1. **CORS protects the user's browser, not your API.** It is enforced client-side. `curl`, Postman, a server-side client and any non-browser attacker ignore it completely. **A permissive CORS policy is not remote code execution on your server; it is the removal of a protection for your users.** Your authentication and authorization must be correct regardless.
2. **It is not a substitute for authentication or CSRF protection.** Different mechanisms, different threats.
3. **Preflight caching is a performance concern.** Without `Max-Age`, every non-simple request becomes two round trips. On a chatty SPA that is a measurable latency cost.

---

## Q17. How do you implement API rate limiting?

Module 15 Q31 covers the algorithms and the security rationale. The API implementation specifics:

**Where to enforce it — layered, cheapest-first:**

| Layer | Mechanism | Best for |
|---|---|---|
| **WAF** | AWS WAF rate-based rules (per IP, per header, scoped by URI path) | Volumetric abuse, cheapest rejection |
| **API Gateway** | Usage plans, per-API-key throttling and daily/monthly quotas | Per-partner commercial limits |
| **Service mesh / ingress** | Envoy or NGINX rate limiting | Uniform policy without code |
| **Application** | `AddRateLimiter` — business-aware limits per user/tenant/endpoint | Rules a gateway cannot express |
| **Downstream** | Concurrency limiters and bulkheads | Protecting a scarce resource (Module 11 Q28) |

```csharp
builder.Services.AddRateLimiter(o =>
{
    // Per-tenant token bucket, from the token's claim — not the IP
    o.AddPolicy("per-tenant", ctx => RateLimitPartition.GetTokenBucketLimiter(
        partitionKey: ctx.User.FindFirstValue("tenant") ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "anon",
        factory: _ => new TokenBucketRateLimiterOptions
        {
            TokenLimit = 200, TokensPerPeriod = 100,
            ReplenishmentPeriod = TimeSpan.FromSeconds(1), QueueLimit = 0
        }));

    // Much tighter on authentication endpoints
    o.AddFixedWindowLimiter("login", opt =>
        { opt.PermitLimit = 5; opt.Window = TimeSpan.FromMinutes(1); opt.QueueLimit = 0; });

    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.OnRejected = async (ctx, ct) =>
    {
        ctx.HttpContext.Response.Headers.RetryAfter = "60";
        await ctx.HttpContext.Response.WriteAsJsonAsync(
            new { type = "https://httpstatuses.io/429", title = "Too Many Requests" }, ct);
    };
});
app.UseRateLimiter();
app.MapPost("/auth/token", …).RequireRateLimiting("login");
```

**The decisions that matter:**

1. **Choose the partition key deliberately.** API key or tenant > user > IP. **IP alone is weak**: carrier NAT puts thousands of users behind one address (so you block legitimate traffic) and attackers rotate proxies (so you block nothing). Use IP only for unauthenticated endpoints, and combine it with other signals.
2. **Per-endpoint limits.** Login, OTP, password reset and token endpoints need limits an order of magnitude tighter than a catalogue read.
3. **Distributed state.** Per-instance limiters mean the real limit is `instances × limit`. Use Redis or the gateway for a fleet-wide limit — and note that a Redis dependency in the request path needs its own failure decision (fail closed on login, open on reads).
4. **Communicate properly.** `429` with `Retry-After` and the `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` headers, and document the limits. Well-behaved clients will back off; undocumented limits produce support tickets and retry storms.
5. **Separate quotas from rate limits.** A rate limit is requests per second; a **quota** is requests per day/month, which is a commercial control for partners.
6. **Monitor rejections.** A spike in 429s is either an attack or a broken client, and both need attention.

---

## Q18. How do you prevent brute-force attacks?

Brute force targets anything with a guessable secret: passwords, OTPs, API keys, password-reset tokens, card numbers, account numbers, and voucher codes.

**Layered defences:**

| Defence | Detail |
|---|---|
| **Rate limiting per account AND per IP** | Per-account stops distributed attacks on one user; per-IP stops one source attacking many accounts. **You need both** — this is the credential-stuffing shape |
| **Progressive delay** | Increasing back-off per failed attempt makes automation impractical without locking anyone out |
| **Account lockout — carefully** | Temporary (15 min) rather than permanent, or an attacker locks out your entire user base as a denial-of-service |
| **MFA** | Even a correct password is insufficient. **The single most effective control**, and phishing-resistant (FIDO2/WebAuthn) is materially better than TOTP or SMS |
| **CAPTCHA / challenge after N failures** | AWS WAF CAPTCHA, Turnstile — raises automation cost without punishing normal users |
| **Breached-password checks** | NIST SP 800-63B recommends checking new passwords against known-compromised corpora (Have I Been Pwned's k-anonymity API) |
| **Strong hashing** | **Argon2id**, scrypt or bcrypt with an appropriate work factor. Never a bare SHA-256; never an unsalted hash (Module 17) |
| **Device fingerprinting / risk scoring** | Impossible travel, new device, unusual hour → step-up authentication |
| **Bot detection** | AWS WAF Bot Control, Fraud Control/ATP |
| **Uniform responses and constant time** | Never reveal whether the username exists; keep the failure path's timing constant so it is not an oracle |

**Specifically for OTP and codes:** short expiry (5 minutes), single use, **strict attempt cap** (3–5 per code, then invalidate the code — not just the attempt), a long-enough code (6 digits with 5 attempts is fine; 4 digits is not), and rate limits on *issuance* as well as verification, so an attacker cannot cycle codes.

**Specifically for API keys:** high entropy (≥256 bits), a prefix for identification and secret-scanning (`pk_live_…`), stored **hashed** like a password, rotatable, and scoped. GitHub's secret-scanning partner programme will notify you if a prefixed key of yours is committed publicly — which is worth designing your key format for.

**Detection and response:** alert on failed-authentication rate by account and by IP, on a sudden rise in the ratio of failures to successes (the credential-stuffing signature), and on successful logins following a burst of failures. Then **notify the user** of new-device or unusual logins, which is often how account takeover is actually caught.

---

## Q19. How do you protect sensitive endpoints?

"Sensitive" means: it moves money, changes authorization, exposes personal data, or alters the system's configuration or security posture.

**The controls, layered:**

**1. Authentication and authorization, strictly.**
- **Step-up authentication** — re-authenticate or require MFA for the operation itself, not just the session. A payment above a threshold, adding a payee, changing MFA settings, or an administrative action should all demand fresh, strong authentication.
- **Fine-grained authorization** — scope + role + attributes + **object-level** (Module 15 Q17–Q20).
- **Segregation of duties / four-eyes** — the approver must not be the requester. In a bank this is mandatory for refunds, adjustments and limit changes.

**2. Reduce exposure.**
- **Administrative APIs should not be internet-facing.** A separate internal ALB, PrivateLink, or a VPN/Zero Trust proxy — not a path on the public API distinguished only by an authorization check.
- **Network restrictions** — allow-list corporate egress ranges for admin endpoints.
- **Separate hostnames/gateways** for public, partner and internal APIs, so the blast radius of a routing mistake is bounded.

**3. Harden the operation itself.**
- **Idempotency keys** on state-changing endpoints (Module 14 Q14).
- **Request signing** and replay protection for partner integrations (Q24).
- **Tighter rate limits** than general endpoints.
- **Confirmation and cooling-off** for the highest-risk actions — a delay before a new payee becomes usable is a genuinely effective anti-fraud control.

**4. Observe everything.**
- **Audit log every access and every decision**, allow or deny, with the principal, the resource, the outcome and the correlation ID — written to an immutable store (S3 Object Lock).
- **Alert in real time** on administrative actions, on authorization denials in bulk (someone probing), and on out-of-hours access.
- **Notify the affected user** for security-relevant changes (password, MFA, payee, contact details) — via a channel the attacker does not control.

**5. Prevent accidental exposure.** A **`FallbackPolicy`** requiring authentication so a new endpoint is never anonymous by default; API inventory and route auditing so nothing is forgotten (Q21/API9); and a CI check that fails if an endpoint has no explicit authorization policy.

**In practice, the highest-value item on this list is step-up authentication combined with four-eyes approval** — because they defend against the case every other control assumes away: a **legitimately authenticated attacker**, whether an external actor with a stolen session or a malicious insider.

---

## Q20. How do you securely handle errors?

**The principle:** *log everything internally; return the minimum externally.* Errors are one of the richest sources of reconnaissance an attacker has.

**What must never reach the client:**

| Leak | Why it matters |
|---|---|
| **Stack traces** | Framework versions, file paths, internal class and namespace names, third-party libraries in use |
| **SQL errors / query text** | Schema, table and column names — directly useful for SQLi and for BOLA enumeration |
| **Connection strings, hostnames, internal IPs** | Internal topology; sometimes credentials |
| **Framework/server version headers** | `Server`, `X-Powered-By`, `X-AspNet-Version` — remove them |
| **Different messages for different failures** | "User not found" vs "Wrong password" is a **user-enumeration oracle**. Same for "card not found" vs "insufficient funds" |
| **Timing differences** | A subtler oracle — a fast rejection for an unknown user and a slow one for a known user leaks the same information |

**What to return:** a stable, generic, machine-readable error with a **correlation ID** the user can quote to support.

```csharp
app.UseExceptionHandler(a => a.Run(async ctx =>
{
    var feature = ctx.Features.Get<IExceptionHandlerFeature>();
    var traceId = Activity.Current?.Id ?? ctx.TraceIdentifier;

    // FULL detail to the log, including the exception
    logger.LogError(feature?.Error, "Unhandled exception. TraceId={TraceId}", traceId);

    // MINIMAL detail to the caller
    ctx.Response.StatusCode = StatusCodes.Status500InternalServerError;
    await ctx.Response.WriteAsJsonAsync(new ProblemDetails
    {
        Type = "https://httpstatuses.io/500",
        Title = "An error occurred processing your request.",
        Status = 500,
        Extensions = { ["traceId"] = traceId }        // the ONLY internal detail exposed
    });
}));
```
Use **RFC 9457 Problem Details** (`AddProblemDetails()`), which gives a standard error shape — and note that **validation errors are the exception to the minimalism rule**: returning which fields failed and why is helpful and not sensitive, provided the messages do not echo raw input or reveal business rules that should stay private.

**Two further rules:**
1. **Never log secrets.** Redact `Authorization` headers, tokens, passwords, PAN and PII at the logging middleware — as configuration, not convention. A token in your log aggregator is readable by far more people than could ever have intercepted it in transit.
2. **Fail closed.** An error in an authorization check must **deny**, never allow. A `try/catch` around a permission lookup that swallows the exception and continues is a critical vulnerability, and it is a pattern that appears in real code.

---

## Q21. How do you prevent information leakage?

Leakage is any unintended disclosure of internal state, structure or data. It rarely constitutes the breach itself — it constitutes the **reconnaissance** that makes the breach possible.

**The channels, and the control for each:**

| Channel | Control |
|---|---|
| **Error responses** | Generic messages + correlation ID (Q20) |
| **HTTP headers** | Remove `Server`, `X-Powered-By`, `X-AspNet-Version`, `X-AspNetMvc-Version` |
| **Status codes** | **`404` rather than `403`** for objects the caller may not see — otherwise the code confirms existence (Q3) |
| **Response timing** | Constant-time comparisons for secrets; uniform failure timing on authentication |
| **Verbose API responses** | Explicit DTOs, never entities (Q5) |
| **Enumerable identifiers** | UUIDv7/ULID rather than sequential integers — defence in depth, not a control |
| **Debug/diagnostic endpoints** | `/swagger`, `/health/detailed`, `/metrics`, `/debug`, `/env` — **not exposed publicly**, or authenticated |
| **Source maps, `.git`, `.env`, backups** | Never deployed; verify with a scanner |
| **Verbose OpenAPI in production** | Publish the contract partners need; do not expose internal-only endpoints |
| **Logs and telemetry** | Redact PII and secrets before they leave the process |
| **DNS and certificates** | Certificate Transparency logs reveal internal hostnames — assume every hostname on a public certificate is known to attackers |
| **Third-party leakage** | Tokens in `Referer` headers, data in analytics/APM payloads, error reporters capturing request bodies |

**Two API-specific ones worth naming:**

1. **Health endpoints.** A detailed health check that lists dependency names, hostnames, versions and connection statuses is a network map. Expose a **shallow** `/health/live` publicly and keep the detailed one internal (Module 10 Q15–Q16).
2. **Differential responses.** Even with identical error messages, a difference in *status code*, *response size* or *timing* between "exists" and "does not exist" is an oracle. Make the entire response identical.

**And the governance layer, which is OWASP API9:** maintain an **inventory of every API, version and environment** — what it is, who owns it, what data it exposes, whether it is public, and when it retires. Forgotten `v1` endpoints and staging environments with production data are among the most common sources of real breaches, and they are an inventory failure rather than a code failure.

---

## Q22. How do you secure file uploads?

File upload is one of the highest-risk features an API can offer, because it accepts attacker-controlled bytes and often stores and later serves them.

**The threats:** malware distribution, remote code execution (an uploaded `.aspx`/`.php` served by the web server), stored XSS (an uploaded HTML or SVG rendered in your origin), **XXE and zip bombs** (a 1 KB archive expanding to 10 GB), path traversal (`../../etc/passwd`), storage exhaustion, and using your domain to host phishing content.

**The controls, in order:**

1. **Validate the file type by content, not by name or by the client's `Content-Type`.** Check **magic bytes** and, for images, actually decode them. An extension and a MIME header are attacker-supplied.
2. **Allow-list extensions and content types.** Never a deny-list — `.pHp`, `.php5`, `.phtml`, double extensions and null bytes all defeat one.
3. **Enforce a maximum size**, at the framework *and* the reverse proxy, and a maximum count per request.
4. **Never trust the filename.** **Generate your own** (a GUID) and store the original only as a metadata attribute. This eliminates path traversal and extension tricks in one step.
5. **Store outside the web root — ideally in object storage, not on the application host.** S3 with a bucket that has **no public access**, encrypted with KMS.
6. **Serve from a different origin** (a separate domain or a CloudFront distribution with a distinct hostname), with **`Content-Disposition: attachment`** and **`X-Content-Type-Options: nosniff`**. Serving user content from your application's origin is what turns an uploaded SVG or HTML file into stored XSS against your own users.
7. **Scan for malware** — GuardDuty **Malware Protection for S3**, or a scanning pipeline triggered on upload — and quarantine until clean.
8. **Handle archives carefully**: cap the decompressed size and the entry count (zip-bomb defence), and reject entries with absolute or traversing paths.
9. **Disable external entities** in any XML/SVG/document parser (XXE).
10. **Authorise the download**, not just the upload. A predictable object key that anyone can fetch is BOLA with a different URL shape. Use **short-lived presigned URLs** generated after an authorization check.
11. **Process untrusted files in isolation** — image resizing, PDF rendering and virus scanning in a separate, low-privilege, network-restricted execution environment, because those parsers are historically where the RCEs are.

**The pattern I would use on AWS:** the client requests a **presigned S3 upload URL** from the API (which authorises the request, fixes the key, and constrains content type and size), uploads **directly to S3** (so the bytes never traverse the application), an S3 event triggers scanning and validation, and only then is the object marked available and served through CloudFront with **Origin Access Control** and a presigned URL. That design removes the upload load from the API entirely and keeps untrusted bytes away from application compute.

---

## Q23. How do you secure webhooks?

Webhooks are unusual in that you are both a **sender** (outbound callbacks to customers) and a **receiver** (inbound callbacks from providers), and the two directions have different threat models.

### Receiving webhooks (a payment provider calls you)

The endpoint is **public and unauthenticated by default** — anyone on the internet can POST to it. Treat it as hostile input.

| Control | Detail |
|---|---|
| **Signature verification** | The provider signs the **raw body** with a shared secret (HMAC-SHA256) or a private key. **Verify before parsing**, and compare in **constant time**. This is the primary authentication |
| **Verify against the raw bytes** | Re-serialising the JSON before verification changes the bytes and breaks the signature — a classic implementation bug |
| **Timestamp + tolerance** | Reject anything older than ~5 minutes to limit **replay** (Q24) |
| **Idempotency** | Providers retry. Dedupe on the event ID; processing must be idempotent (Module 14 Q16) |
| **Do not trust the payload's data** | Treat it as a **notification, not a fact**. For anything financial, **call the provider's API to confirm the current state** rather than acting on the body |
| **Respond fast, process async** | Return `200` immediately and enqueue. Providers time out and retry aggressively; slow processing produces duplicate storms |
| **Rate limit and size limit** | It is a public endpoint |
| **Source IP allow-list** | Useful defence in depth where the provider publishes ranges — never the only control |
| **Secret rotation** | Support two active signing secrets so rotation needs no downtime |

### Sending webhooks (you call a customer)

| Control | Detail |
|---|---|
| **Sign your payloads** | HMAC over the raw body with a per-customer secret, plus a timestamp; document the algorithm so customers can verify |
| **SSRF protection on the destination URL** | The customer supplies it — **this is a first-class SSRF vector** (Q8). Allow-list schemes, block private/link-local ranges, resolve-and-pin, disable redirects |
| **HTTPS only**, with certificate validation |
| **Retry with exponential backoff and jitter**, a bounded attempt count, then a DLQ and a customer-visible failure state |
| **Timeouts** so a slow customer endpoint cannot occupy your resources |
| **Circuit breaker per destination** so one broken customer does not degrade delivery for everyone |
| **Send from an isolated egress path** — a dedicated component with no IAM permissions and no route to internal services |
| **Minimal payloads** — send an event type and an ID; let the customer fetch the detail through an authenticated API. **This limits what a misdirected webhook can leak** |

**The two points that most demonstrate experience:** treating an inbound webhook as an **untrusted notification to be verified against the provider's API** rather than as authoritative data, and recognising that **outbound webhooks are a customer-controlled SSRF surface** inside your own network.

---

## Q24. How do you prevent replay attacks?

A **replay attack** captures a legitimate request and re-sends it. The request is genuine and correctly signed, so signature verification alone does not stop it — you need something that makes each request **single-use**.

**The mechanisms, and they are usually combined:**

| Mechanism | How it works |
|---|---|
| **Timestamp + tolerance window** | The request carries a timestamp, included in the signature; reject anything outside ±5 minutes. **Bounds the replay window but does not close it** |
| **Nonce + cache** | A unique value per request, stored for at least the timestamp window; a repeat is rejected. **This is what actually closes the window** |
| **Idempotency key** | Not a security control, but it makes a replayed *state-changing* request harmless (Module 14 Q14) |
| **Sequence numbers** | A monotonically increasing counter per client; reject anything not greater than the last seen |
| **Short-lived tokens** | Bounds the value of a captured `Authorization` header |
| **Sender-constrained tokens** (mTLS-bound, DPoP) | A captured token is useless without the private key (Module 15 Q9) |
| **TLS** | Prevents passive capture in the first place — necessary, not sufficient (a malicious client or a compromised endpoint can still replay) |

**A signed, replay-resistant request:**
```
POST /payments
X-Timestamp: 1757328000
X-Nonce:     8f3a2c1e-4b7d-4e6f-9a1c-2d3e4f5a6b7c
X-Signature: base64(HMAC-SHA256(secret,
                 timestamp + "\n" + nonce + "\n" + method + "\n" + path + "\n" + sha256(body)))
```
Server-side:
```
1. |now − timestamp| ≤ 300s ?              else reject (window)
2. nonce unseen in the cache (TTL 300s)?   else reject (replay)   ← the actual defence
3. signature valid, over the RAW body, compared in CONSTANT TIME?  else reject
4. record the nonce, then process
```

**The details that make or break it:**
- **Include the timestamp, nonce, method, path and a hash of the body in the signature.** Signing only the body lets an attacker replay it against a different endpoint.
- **The nonce cache TTL must be ≥ the timestamp tolerance.** Otherwise a nonce expires while its timestamp is still valid, reopening the window.
- **Use a distributed cache** (Redis with TTL, or DynamoDB with TTL) — a per-instance cache means a replay to a different instance succeeds.
- **Constant-time comparison** (`CryptographicOperations.FixedTimeEquals`) — a naive `==` on the signature leaks it byte by byte through timing.
- **Verify the raw bytes**, before any deserialisation or re-serialisation.

**Where this is mandatory in fintech:** partner and merchant API integrations, inbound webhooks (Q23), and anything under a signing standard such as **FAPI** (which uses detached JWS signatures with `jti` and `iat` serving exactly these roles). And note the belt-and-braces point: **idempotency keys mean that even a successful replay does not double-charge** — the security control and the correctness control reinforce each other.

---

## Q25. How do you threat-model an API?

**Threat modelling is a structured exercise to find design-level security flaws before they are built** — the flaws that no scanner, linter or penetration test will reliably catch, because they are architectural rather than syntactic.

**The four questions** (Shostack's framing, and the one to use because it is simple enough that people actually do it):

1. **What are we building?** — a data-flow diagram: components, data stores, external entities, and **trust boundaries**.
2. **What can go wrong?** — enumerate threats, usually with **STRIDE**.
3. **What are we going to do about it?** — mitigations, mapped to threats.
4. **Did we do a good job?** — validate, test, and revisit.

**STRIDE applied to a payments API:**

| Threat | Example | Mitigation |
|---|---|---|
| **S**poofing | Impersonating a merchant | mTLS, `private_key_jwt`, signed requests |
| **T**ampering | Modifying the amount in transit or in a queue | TLS, request signing, message signing |
| **R**epudiation | *"I never authorised that refund"* | Immutable audit log, event sourcing, four-eyes with attribution |
| **I**nformation disclosure | BOLA, over-exposure, verbose errors | Object-level authz, DTOs, generic errors |
| **D**enial of service | Resource exhaustion, retry storms, cost abuse | Rate limits, quotas, bulkheads, budget alarms |
| **E**levation of privilege | Mass assignment setting `isAdmin`; missing function-level authz | Explicit DTOs, policy-based authz, fail-closed defaults |

**Doing it well, in practice:**

- **Start from the data-flow diagram and mark the trust boundaries.** Every arrow crossing a boundary is where threats live: internet → gateway, gateway → service, service → database, service → third party, and **each of those in reverse**.
- **Ask "what does an attacker want here?"** In payments: move money, read card data, avoid detection, deny service to a competitor, or generate cost. Working backwards from the objective finds threats that a checklist misses.
- **Include the insider and the compromised-dependency cases.** A malicious or compromised internal service, a poisoned package, a leaver with a valid token.
- **Rank by risk** — likelihood × impact — and mitigate accordingly. A threat model that produces 200 undifferentiated findings gets ignored.
- **Record decisions, including accepted risks**, with an owner and a review date. Accepted risk with a name attached is governance; unrecorded risk is negligence.
- **Do it at design time and repeat on significant change** — a new integration, a new data type, a new trust boundary. Threat modelling once at project start and never again is the common failure.

**Complementary structures worth naming:** **OWASP ASVS** as the requirements checklist to verify against, the **API Security Top 10** as a prompt list for the "what can go wrong" step, **MITRE ATT&CK** for realistic adversary techniques, and **abuse cases** written alongside user stories (*"as an attacker, I want to enumerate merchant IDs"*) so that security requirements enter the backlog the same way features do — which is what makes this stick in a real delivery team.

---

## References — official documentation and standards

| Topic | Source |
|---|---|
| **OWASP API Security Top 10 (2023)** | https://owasp.org/API-Security/editions/2023/en/0x11-t10/ |
| OWASP Top 10 (web) | https://owasp.org/www-project-top-ten/ |
| OWASP Cheat Sheet Series (index) | https://cheatsheetseries.owasp.org/ |
| OWASP — REST Security Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html |
| OWASP — Authorization Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html |
| OWASP — Mass Assignment Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html |
| OWASP — SQL Injection Prevention | https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html |
| OWASP — Input Validation Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html |
| OWASP — Cross-Site Scripting Prevention | https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html |
| OWASP — CSRF Prevention Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html |
| OWASP — SSRF Prevention Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html |
| OWASP — File Upload Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html |
| OWASP — Error Handling Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html |
| OWASP — Threat Modeling Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html |
| OWASP ASVS (Application Security Verification Standard) | https://owasp.org/www-project-application-security-verification-standard/ |
| Microsoft Learn — ASP.NET Core security overview | https://learn.microsoft.com/en-us/aspnet/core/security/ |
| Microsoft Learn — model binding and over-posting | https://learn.microsoft.com/en-us/aspnet/core/mvc/models/model-binding |
| Microsoft Learn — rate limiting middleware | https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit |
| Microsoft Learn — handle errors / Problem Details | https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling |
| Microsoft Learn — CORS | https://learn.microsoft.com/en-us/aspnet/core/security/cors |
| Microsoft Learn — antiforgery (CSRF) | https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery |
| Microsoft Learn — upload files safely | https://learn.microsoft.com/en-us/aspnet/core/mvc/models/file-uploads#security-considerations |
| Microsoft Learn — EF Core raw SQL queries | https://learn.microsoft.com/en-us/ef/core/querying/sql-queries |
| Microsoft Learn — EF Core global query filters | https://learn.microsoft.com/en-us/ef/core/querying/filters |
| RFC 9457 — Problem Details for HTTP APIs | https://www.rfc-editor.org/rfc/rfc9457 |
| RFC 9110 — HTTP Semantics | https://www.rfc-editor.org/rfc/rfc9110 |
| RFC 6455 / RFC 9700 / RFC 8705 — WebSocket, OAuth BCP, mTLS tokens | https://www.rfc-editor.org/rfc/rfc9700 |
| NIST SP 800-63B — Digital Identity Guidelines | https://pages.nist.gov/800-63-3/sp800-63b.html |
| AWS WAF developer guide (rate-based rules, Bot Control, ATP) | https://docs.aws.amazon.com/waf/latest/developerguide/waf-chapter.html |
| AWS API Gateway — throttling and usage plans | https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html |
| AWS — S3 presigned URLs | https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html |
| AWS — GuardDuty Malware Protection for S3 | https://docs.aws.amazon.com/guardduty/latest/ug/gdu-malware-protection-s3.html |
| AWS Well-Architected — Security pillar | https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html |
| PCI DSS document library | https://www.pcisecuritystandards.org/document_library/ |

---

**Previous:** [15 — Security](./15-Security.md) | **Next:** [17 — Database / Data Security](./17-Database-Data-Security.md)
