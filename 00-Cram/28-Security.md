# Security — Cram Sheet

> Tier 1 · Source: `28-Security/` (4 modules, 2,888 lines) · Read: 15 min

---

## 1. OWASP Top 10 (the ones that get asked)

- **A01 Broken Access Control** — *the #1 risk*. Authentication answers "who"; authorization answers **"allowed to touch this specific object."** IDOR/BOLA = `/orders/{id}` with no ownership check. **Fix: resource-based authorization on every object access, enforced server-side.** Never rely on the UI hiding a button.
- **A03 Injection** — **parameterisation, not sanitisation, is the real fix.** Parameterised queries / `DbParameter`; never string concatenation, never a blocklist. Same principle for OS commands (arg arrays, not shell strings), LDAP, and XPath.
- **A02 Cryptographic Failures** — data in transit without TLS, data at rest unencrypted, weak/homemade crypto, secrets in source control.
- **XSS** — untrusted data in HTML. Fix: **contextual output encoding** (the context — HTML body, attribute, JS, URL — decides the encoder) + **CSP**. Razor auto-encodes; `@Html.Raw` is where it breaks.
- **CSRF** — the browser sends cookies automatically. Fix: **anti-forgery token** + `SameSite=Lax/Strict` cookies. **APIs using `Authorization: Bearer` are not CSRF-vulnerable** (the header isn't sent automatically) — say this, it separates candidates.
- **SSRF** — the server fetches a user-supplied URL and reaches internal services (e.g. the cloud metadata endpoint `169.254.169.254`). Fix: allow-list destinations, block link-local/private ranges, **IMDSv2**, no redirects followed blindly.
- **Security misconfiguration / vulnerable components** — default credentials, verbose errors, open S3 buckets, unpatched dependencies.

---

## 2. Threat Modelling

- **STRIDE:** **S**poofing · **T**ampering · **R**epudiation · **I**nformation disclosure · **D**enial of service · **E**levation of privilege.
- **Trust boundaries** are the thing to draw — every arrow crossing one needs authentication, authorization, validation and logging.
- **Shift left:** threat model at design time. A pentest at the end finds *instances*; a threat model finds *classes*.
- Output is a prioritised list of mitigations with owners — not a document.

---

## 3. Cryptography

- **Symmetric** (AES-GCM) = fast, one shared key, the problem is distribution. **Asymmetric** (RSA, ECDSA) = slow, solves distribution. **TLS uses a hybrid:** asymmetric to agree a key, symmetric for the data.
- **Hashing ≠ encryption.** Hashing is **one-way, not reversible, no key**. Encryption is reversible with a key.
  - Integrity/dedup → SHA-256.
  - **Passwords → a deliberately slow KDF: Argon2id (preferred), bcrypt, scrypt, PBKDF2 — with a per-user salt.** Never SHA-256 for passwords (too fast → GPU-crackable).
  - Message authentication → **HMAC**, not a bare hash.
- **AEAD** (AES-GCM, ChaCha20-Poly1305) gives confidentiality *and* integrity. Encryption without authentication is a bug.
- **Digital signature** = hash, then encrypt the hash with the **private** key; verify with the public key. Gives authenticity + integrity + non-repudiation.
- **Certificate chain:** leaf → intermediate → root CA in the trust store. Validate chain, expiry, hostname, and revocation (OCSP stapling).
- **Key management lifecycle:** generate (in an HSM/KMS) → distribute → rotate (on a schedule *and* on suspicion) → revoke → destroy. **Envelope encryption**: KMS holds the key-encryption key; a data key encrypts the payload.
- **Forward secrecy** — ephemeral key exchange (ECDHE) so a future private-key compromise cannot decrypt past traffic. TLS 1.3 mandates it.
- **Implementation failures that are invisible until tested:** ECB mode (patterns survive), a reused IV/nonce (catastrophic for GCM), `Random` instead of a CSPRNG, non-constant-time comparison (timing attack), rolling your own crypto, hard-coded keys.

---

## 4. Security Testing

| | What it does | Blind spot |
|---|---|---|
| **SAST** | scans source/bytecode, early, full coverage | high false positives; **cannot see runtime config or business-logic flaws** |
| **DAST** | attacks the running app from outside — proves exploitability | needs a deployed app, late, low code coverage, poor at auth-gated paths |
| **IAST** | instruments the running app, combines both | needs an agent; language support |
| **SCA** | dependency CVEs | **transitive dependencies** are the real problem; reachability matters more than count |
| **Fuzzing** | coverage-guided mutated input | needs a harness; best for parsers/protocols |
| **Pentest** | human creativity, chained exploits | point-in-time, expensive |

- **SCA nuance worth saying:** a CVE in a package you ship but never call on a reachable path is not the same risk as one on your auth path. Prioritise by **reachability and exploitability**, not by CVSS alone.
- **Vulnerability management lifecycle:** discover → triage/prioritise → assign an owner and an SLA by severity → remediate → verify → measure **mean time to remediate**.
- In CI: SAST + SCA on every PR (fail on high), DAST on a deployed environment, secrets scanning pre-commit, image scanning on push to the registry.

---

## 5. Zero Trust

- **Principle: never trust, always verify.** The network location grants nothing — identity, device posture and context do.
- **PDP / PEP split:** the **Policy Decision Point** evaluates (centralised policy); the **Policy Enforcement Point** enforces (at each service/proxy). Separating them is what makes policy consistent and auditable.
- **Continuous verification, not one-time authentication** — re-evaluate per request, not once per session. A session that survives a device being compromised is the failure mode.
- **Micro-segmentation + workload identity** — services authenticate to each other (mTLS, SPIFFE), not by IP allow-list.
- **Identity is the new perimeter** — plus device posture (managed, patched, encrypted).
- **The hidden cost: policy sprawl and exception drift.** Exceptions are granted for a deadline and never removed; nobody can enumerate them. This is the realistic failure, and naming it is a Principal-level signal.

---

## 6. Compliance (what each actually verifies)

| Framework | Verifies |
|---|---|
| **PCI-DSS** | cardholder data handling — segmentation, encryption, **never store the PAN/CVV**, tokenise, scoped audits |
| **SOC 2** | that your stated controls operate over a period (Type II) |
| **SOX** | financial reporting integrity — change management, segregation of duties, audit trail |
| **GDPR** | lawful basis, data-subject rights, breach notification (72h), data residency, minimisation |
| **ISO 27001** | an information security *management system* exists and is audited |
| **HIPAA** | protected health information |

**Interview framing:** compliance is a floor, not a security programme. Controls that only exist at audit time are theatre — say what is continuously enforced (policy-as-code in CI, automated evidence collection) versus attested annually.

---

## 7. Secure .NET specifics

- Parameterised queries / EF Core (which parameterises by default — but **`FromSqlRaw` with interpolation does not**; use `FromSqlInterpolated`).
- `[ValidateAntiForgeryToken]`, `SameSite` cookies, `HttpOnly`, `Secure`.
- **HSTS**, `UseHttpsRedirection`, security headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`).
- **Data Protection API** for at-rest app secrets; shared key ring across replicas.
- **Never log:** tokens, passwords, PANs, full request bodies on auth endpoints. Watch record `ToString()`.
- Secrets from Key Vault / Secrets Manager, never `appsettings.json` in source control.
- **Rate-limit and add constant-time comparison on authentication endpoints** — otherwise you leak account existence by timing.

---

## Top traps

1. Sanitisation (blocklists) instead of parameterisation.
2. Authenticated ≠ authorized for *this object* (BOLA/IDOR).
3. SHA-256 for passwords.
4. Reusing an IV/nonce with AES-GCM.
5. Encryption without authentication (no AEAD/HMAC).
6. Claiming a bearer-token API needs CSRF protection.
7. `@Html.Raw` / manual string concatenation into HTML.
8. Trusting the cloud metadata endpoint reachable via SSRF.
9. Treating a CVE count as a risk measure, ignoring reachability.
10. Zero Trust described as a product rather than a policy architecture.

---

## Interview Q&A — Lead / Principal

### Q1 · A critical CVE lands on a Friday *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"A CVSS 9.8 is announced in a library you use. It's 4pm Friday. What happens?"*

**Answer.** CVSS is a severity score, not a risk assessment, so the first question is **are we actually exploitable** — three things decide it: is the vulnerable code path **reachable** in our usage, is the component **exposed** to untrusted input, and are there **compensating controls** (a WAF rule, network isolation, the component being internal-only). A 9.8 in a parser we never call on an internal service is a Monday problem; a 9.8 in our public auth path is a Friday-night problem. That triage is the whole answer, and the SBOM is what makes it answerable in minutes instead of days.

If it is exploitable: patch if a fixed version exists and our pipeline can ship safely — and this is the moment that tests whether we can actually deploy on a Friday, which is a deployment-capability finding as much as a security one. If no patch exists, mitigate: a WAF rule, disabling the feature, or network-level restriction, and accept the residual risk explicitly with a named owner and a review date.

Then the systemic part, which is what I'd actually push afterwards: the goal is not to be fast at this, it's to **not be surprised** by it. SCA in CI with reachability analysis, an SBOM per artifact so "where is this library" is a query rather than an investigation, and automated dependency updates so we're normally a version or two behind rather than two years.

**Why it lands.** Rejects CVSS-as-risk, gives the three-factor triage, treats Friday deployability as a finding, and moves to prevention.
**✗ Weak answer.** "Patch immediately, it's a 9.8" — no triage, and possibly a worse outage than the vulnerability.
**↳ Follow-ups.** How long to answer "where is this library"? What if the fix is a breaking major version?

---

### Q2 · Secrets in the repository *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"A scan finds an AWS access key committed to a repo eighteen months ago. What do you do?"*

**Answer.** Order matters and most people get it wrong. **Rotate first, investigate second.** The key is compromised the moment it's in history — git history is public to anyone who ever cloned, and removing the commit does not un-leak it. So: revoke the credential immediately, then check CloudTrail for any use from an unexpected source or region across the full exposure window, then scope what that identity could reach to determine blast radius. Rewriting history is the *last* step and it's cosmetic, not remediation.

Then the structural question, which is the real one: why could a long-lived static credential exist at all? The fix is that workloads use **role-based short-lived credentials** — instance profiles, IRSA, OIDC federation for CI — so there's no static key to leak. Plus pre-commit secret scanning and a server-side push protection so the next one is blocked rather than found eighteen months later.

I'd also treat the eighteen months as its own finding: our detection took a year and a half, which is a bigger problem than the key.

**Why it lands.** Rotate-before-investigate, history-rewrite as cosmetic, eliminates static credentials structurally, and flags the detection delay.
**✗ Weak answer.** "Remove it from git history and force-push."
**↳ Follow-ups.** How do you scope blast radius? What replaces the key in CI?

---

### Q3 · The security control that blocks the business *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"Security is blocking a launch over a finding the team thinks is theoretical. You're asked to arbitrate."*

**Answer.** I'd reframe from "is it a real risk" to "what is the risk, who owns it, and what's the cheapest thing that changes the answer" — because the argument as posed has no resolution, both sides are asserting.

Concretely: get the finding stated as an **exploit scenario** rather than a category — who does what, with what access, to achieve what. A lot of theoretical findings collapse at that step, and a few turn out to be worse than claimed. If it's real, look for a **compensating control** that unblocks the launch at lower cost than the full fix: feature-flag the risky path off at launch, restrict it to internal users, add detection so we'd know if it were exploited. That converts a binary blocker into a sequenced plan.

If it genuinely can't be mitigated and the business still wants to ship, then it's a **risk acceptance** — written down, with a named accountable owner at the right level, an expiry date, and a remediation commitment. Not an engineer's call, and not a security team's veto either. What I'd refuse is the middle path where everyone tacitly ships and nobody owns it.

The organisational note: if security is discovering this at launch, the process is broken — threat modelling belongs at design time, where it finds *classes* of issue cheaply rather than instances expensively.

**Why it lands.** Converts assertion into an exploit scenario, finds compensating controls, and puts risk acceptance at the right level with an expiry — then names the process failure.
**✗ Weak answer.** Siding with either party, or "ship it, we'll fix it later."
**↳ Follow-ups.** Who signs a risk acceptance in your organisation? What if the finding is in a third party?

---

### Quick-fire (30 seconds each)

- **"How do you prevent SQL injection?"** → Parameterised queries, always — the fix is separating code from data, not filtering the data. Sanitisation and blocklists fail because you're trying to enumerate every encoding an attacker might use. EF Core parameterises by default, but `FromSqlRaw` with string interpolation reintroduces the hole, so `FromSqlInterpolated` or explicit parameters. Least-privilege database accounts are the second layer so a successful injection can't drop tables.
- **"How should passwords be stored?"** → Argon2id with a per-user salt and tuned cost parameters; bcrypt or PBKDF2 are acceptable if Argon2 isn't available. The point is that the algorithm is *deliberately slow* — SHA-256 is fast, which is exactly wrong, because a GPU does billions per second. Plus rate limiting and constant-time comparison so you don't leak account existence by timing.
- **"What is Zero Trust, concretely?"** → Not a product — an architecture where network location grants nothing. Every request is authorized on identity, device posture and context, at a policy enforcement point, against a centralised policy decision point, re-evaluated continuously rather than once at login. In practice that's mTLS with workload identity between services, short-lived credentials, and micro-segmentation. The realistic failure is policy sprawl — exceptions granted for a deadline that nobody can later enumerate.

---

**Go deeper:** `28-Security/01`–`04` · **Related:** [[41-OAuth2-OIDC-JWT]], [[38-APIGateway-ServiceMesh-IAM]], [[03-REST-APIs]], [[21-AWS]]
