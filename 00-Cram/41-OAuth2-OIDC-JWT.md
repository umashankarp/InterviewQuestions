# OAuth2 · OIDC · JWT · PKCE — Cram Sheet

> Tier 1 · Source: `41-OAuth2-OIDC-JWT-PKCE/` (3 modules, 1,854 lines) · Read: 12 min

---

## 1. The one-line distinction (asked constantly)

- **OAuth 2.0 = authorisation.** Delegated access to an API. Produces an **access token**. It is **not** an authentication protocol.
- **OIDC = authentication**, a thin layer on top of OAuth 2.0. Produces an **ID token** (a JWT about *the user*).
- **JWT = a token format**, not a protocol. Access tokens may or may not be JWTs.
- **SAML** = the older XML-based federation protocol; still everywhere in enterprises.

**Roles:** Resource Owner (the user) · Client (the app) · Authorization Server (issues tokens) · Resource Server (the API).

---

## 2. Grant types

| Grant | Use | Status |
|---|---|---|
| **Authorization Code + PKCE** | **everything user-facing** — SPA, mobile, web app | ✅ the default answer |
| **Client Credentials** | machine-to-machine, no user | ✅ |
| **Device Code** | TVs, CLIs, input-constrained devices | ✅ |
| **Refresh Token** | obtaining a new access token | ✅ (with rotation) |
| Implicit | SPAs, historically | ❌ **deprecated** — token in the URL fragment: leaks via history, referrer, logs; no client authentication |
| Resource Owner Password | legacy | ❌ deprecated — the app sees the password, defeats MFA and federation |

---

## 3. PKCE — the specific vulnerability it closes

- **The attack (authorization code interception):** a public client (mobile/SPA) cannot hold a secret. A malicious app registering the same custom URL scheme intercepts the redirect and steals the **authorization code**, then exchanges it for a token.
- **PKCE (RFC 7636):**
  1. Client generates a random **`code_verifier`**.
  2. Sends **`code_challenge` = BASE64URL(SHA-256(verifier))** with `code_challenge_method=S256` on the authorize request.
  3. On token exchange, sends the **raw `code_verifier`**.
  4. The authorization server hashes it and compares. A stolen code is useless without the verifier.
- **Use `S256`, never `plain`.** PKCE is now recommended for **confidential clients too**, not just public ones.

---

## 4. JWT structure & validation

```
header.payload.signature      (base64url, dot-separated; signature over header+payload)
header  : { "alg": "RS256", "kid": "abc" }
payload : { "iss", "sub", "aud", "exp", "nbf", "iat", "jti", "scope", ... }
```

**The validation steps a resource server must not skip:**
1. **Verify the signature** — with a key resolved by `kid` from the issuer's **JWKS endpoint**, cached and refreshed.
2. **`iss`** matches the expected issuer.
3. **`aud`** matches *this* API. (Skipping this lets a token minted for another service be replayed at yours.)
4. **`exp` / `nbf`** with a small clock-skew allowance.
5. **`alg`** matches an **allow-list you configure** — see below.
6. Scopes/claims authorise the specific operation.

- **Algorithm-confusion attack:** never trust `alg` *from the token*. Two classic forms — `alg: none` (accepted as unsigned), and **RS256 → HS256 substitution** where the attacker signs with the public key as an HMAC secret. **Fix: the server declares the accepted algorithm; the token never selects it.**
- **JWT is signed, not encrypted** — the payload is readable by anyone. **Never put secrets or PII in a JWT.** (JWE exists if you genuinely need encryption.)

---

## 5. ID token vs access token

| | **ID token** | **Access token** |
|---|---|---|
| Audience | **the client app** | **the resource server (API)** |
| Purpose | *who the user is* — authentication | *what may be done* — authorisation |
| Format | always a JWT | JWT or opaque |
| Sent to an API? | **No** | Yes, `Authorization: Bearer` |

**The classic mistake: sending the ID token to the API.** The API is not its audience; accepting it is an audience-validation failure.

---

## 6. Token lifecycle

- **Why refresh tokens exist:** keep access tokens **short-lived** (5–15 min, so a leak has a small window) without forcing the user to re-authenticate. The refresh token is long-lived and held more carefully.
- **Refresh token rotation:** each use issues a *new* refresh token and invalidates the old one. **Replay detection:** if an already-used refresh token is presented, the whole token family is revoked — that's the signal a token was stolen.
- **The revocation-propagation problem:** a self-contained JWT is valid until `exp` **because the resource server does not call anyone to check it**. That is the entire performance benefit, and the entire cost. Mitigations:
  - short expiry (the main lever),
  - a **revocation/deny list** of `jti` for the remaining lifetime,
  - **introspection** (RFC 7662) — ask the authorization server on every request: real-time truth, but a network hop and a dependency, and you have given up the stateless benefit,
  - a hybrid: JWT for most APIs, introspection for high-value operations.
- **Sender-constrained tokens** — stop a stolen bearer token being usable by anyone:
  - **DPoP** — the client proves possession of a key by signing each request; a `cnf` claim binds the token to that key. **Application-layer, no PKI infrastructure.**
  - **mTLS (RFC 8705)** — the token is bound to the client's TLS certificate. Stronger, but needs certificate lifecycle infrastructure. The usual answer in banking.

---

## 7. Enterprise SSO & Federation

- **Identity broker/hub pattern** beats point-to-point federation: N identity providers × M applications becomes N + M integrations instead of N × M, with one place to normalise claims, audit, and enforce policy.
- **Claims mapping/normalisation is the seam where partner semantics silently diverge** — one IdP's `role=admin` is not another's. Normalise explicitly and version the mapping.
- **Token exchange (RFC 8693)** for delegation across services — and the **confused-deputy risk**: a downstream service acting with more authority than the original caller had. Always carry the original subject (`act`/`may_act`) and re-check authorisation downstream.
- **Single sign-out is the federation-scale inverse of the revocation problem** — you must propagate logout to every relying party, and back-channel logout is unreliable in practice. Say honestly that short sessions are the realistic mitigation.
- **SAML vs OIDC — both still coexist:** SAML is entrenched in enterprise/workforce SSO (and many B2B partners only speak it); OIDC is the choice for anything new, mobile, or API-centric.

---

## 8. Cookies vs tokens for your own app

- **Cookie + server session:** easy revocation, small, needs `HttpOnly`/`Secure`/`SameSite` + CSRF protection, and a **shared data-protection key ring** across replicas.
- **JWT bearer:** stateless, horizontally scalable, cross-domain friendly — but revocation is hard and it must never be stored in `localStorage` (XSS-readable). **Best practice for SPAs: BFF pattern** — tokens stay server-side, the browser holds only an `HttpOnly` cookie.

---

## Top traps

1. Calling OAuth2 an authentication protocol.
2. Sending the **ID token** to an API.
3. Skipping **`aud`** validation.
4. Trusting `alg` from the token (`none`, RS256→HS256).
5. Putting PII/secrets in a JWT payload (signed ≠ encrypted).
6. Implicit grant for a SPA.
7. PKCE with `plain` instead of `S256`.
8. Refresh tokens without rotation and replay detection.
9. Claiming a stateless JWT can be revoked instantly.
10. Storing tokens in `localStorage`.

---

## Interview Q&A — Lead / Principal

### Q1 · Revoking access immediately *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"Compliance requires that when we disable an employee, their access stops within 60 seconds. We use JWTs. Design it."*

**Answer.** I'd start by being direct: a self-contained JWT **cannot** be revoked — it's valid until `exp` because the resource server deliberately doesn't call anyone, and that's the entire performance benefit. So the requirement and the token design are in tension, and the answer is to choose where to pay.

Options, by cost. **Short expiry** — 60-second access tokens with rotating refresh tokens — meets the requirement almost exactly, at the price of a token exchange every minute, which is load on the authorization server and a hard dependency on its availability. **Introspection** on every request gives real-time truth but gives up statelessness and adds a network hop to every call. **A revocation list** — publish revoked `jti`s, resource servers cache it for the residual token lifetime — is a middle path, cheap, and it only needs to hold entries until `exp`.

What I'd actually propose is **tiered**: short-lived tokens plus a revocation list for ordinary APIs, and **introspection on the genuinely high-value operations** — payment initiation, admin actions, data export. That meets the compliance requirement where it matters without a hop on every request. I'd also confirm what "access stops" means to compliance: an in-flight long-running operation may continue, and that needs stating rather than assuming.

**Why it lands.** States the impossibility plainly, prices three options, proposes a tiered design, and clarifies the requirement rather than accepting it verbatim.
**✗ Weak answer.** "Use a blacklist" with no mention of the statelessness trade — or claiming JWTs can be revoked.
**↳ Follow-ups.** Where does the revocation list live? What's the availability impact of 60-second tokens?

---

### Q2 · Securing a SPA *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"Our Angular app stores the access token in `localStorage`. The security review flagged it. What's your recommendation?"*

**Answer.** They're right — anything in `localStorage` is readable by any JavaScript on the page, so a single XSS anywhere, including in a third-party dependency, exfiltrates the token. And a stolen bearer token is fully usable by the attacker from anywhere, because nothing binds it to the client.

The recommendation is the **BFF pattern**: the backend-for-frontend holds the tokens server-side and issues the browser an `HttpOnly`, `Secure`, `SameSite` cookie. JavaScript then cannot read the credential at all, which closes the XSS exfiltration path structurally rather than by hoping we have no XSS. The trade-off to state: cookies reintroduce **CSRF**, so anti-forgery tokens and `SameSite` are required, and the BFF is now a stateful component to run. In exchange the refresh token never reaches the browser, and the BFF can also handle per-client aggregation so the SPA isn't orchestrating calls across microservices.

If a BFF genuinely isn't viable, the fallback is in-memory storage with a silent-refresh iframe — better than `localStorage`, but it loses the token on refresh and is more fragile. And regardless: **Authorization Code with PKCE**, never implicit, and a strict CSP to reduce the XSS surface in the first place.

**Why it lands.** Explains why it's structural rather than a hardening tweak, names the CSRF trade honestly, and gives a fallback plus the baseline flow.
**✗ Weak answer.** "Move it to `sessionStorage`" — same XSS exposure.
**↳ Follow-ups.** How does the BFF handle token refresh? What's your CSP?

---

### Quick-fire (30 seconds each)

- **"OAuth2 vs OIDC vs JWT?"** → OAuth2 is delegated *authorisation* and gives an access token for an API. OIDC is a thin authentication layer on top that adds an ID token describing the user. JWT is just a token format — a signed, base64 JSON envelope — which either of them may or may not use. The common mistake is using OAuth2 alone for login, which gives you a token that says what you can do but never reliably says who you are.
- **"Why PKCE?"** → Because a public client can't keep a secret, so the authorization code alone is enough for an attacker who intercepts the redirect — historically via a malicious app registering the same custom URL scheme. PKCE binds the code to a one-time secret: the client sends the SHA-256 of a random verifier up front and the raw verifier at exchange, so an intercepted code is useless. It's now recommended for confidential clients too.
- **"How do you revoke a JWT?"** → Honestly, you don't — a self-contained token is valid until it expires, because the whole point is that the resource server doesn't call anyone. So you manage the window: short-lived access tokens with rotating refresh tokens plus replay detection, a `jti` deny list for the residual lifetime, and introspection on genuinely high-value operations. If a design requires instant revocation everywhere, self-contained tokens are the wrong choice and I'd say so.

---

**Go deeper:** `41-OAuth2-OIDC-JWT-PKCE/01`–`03` · **Related:** [[38-APIGateway-ServiceMesh-IAM]], [[28-Security]], [[02-DotNet-AspNetCore]]
