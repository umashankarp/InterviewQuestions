# API Gateway · Service Mesh · IAM — Cram Sheet

> Tier 3 (thin recall) · Source: `38-API-Gateway/` `39-Service-Mesh/` `40-IAM/` (5 modules, 2,996 lines) · Read: 8 min

---

## 1. API Gateway

- **What belongs in it:** TLS termination · authentication (token validation) · rate limiting & quotas · routing & versioning · request/response transformation · caching · observability & correlation ids · WAF.
- **What does NOT belong in it:** business logic · orchestration across services · data aggregation with domain rules. A gateway that acquires business logic becomes an **ESB** — the SOA failure repeated.
- **Gateway vs load balancer:** an LB distributes traffic across identical instances; a gateway is an **application-aware policy and routing layer** (per-route auth, per-consumer quotas, protocol translation).
- **BFF (Backend for Frontend)** — one gateway per client type (web / mobile / partner), because their aggregation and payload needs genuinely differ. Prevents one gateway serving everyone badly.
- **North-south (gateway) vs east-west (service mesh)** — the standard framing. They are complementary, not alternatives.
- **The gateway is the highest-blast-radius component you own.** Consequences: it must be stateless and horizontally scaled, its config changes need the same rollout discipline as code (canary the config), and **you need a plan for "who watches the watchman"** — its own health cannot be checked only through itself.
- **Failure posture:** fail-closed at the authentication boundary; fail-open for non-critical enrichment. Say which, per concern.
- Products: AWS API Gateway · Azure API Management · Kong · NGINX · Envoy · YARP (.NET).

---

## 2. Service Mesh

- **What it is:** a sidecar proxy (Envoy) beside every service, giving **mTLS, retries, timeouts, circuit breaking, traffic splitting, and golden-signal telemetry** — **without changing application code**. Control plane (Istio/Linkerd) configures the data plane (the proxies).
- **The real argument for it:** polyglot fleets. With one language you can get most of this from a library (Polly + OpenTelemetry) at a fraction of the cost. **With five languages, a mesh stops you maintaining five resilience libraries.**
- **The real cost:** an extra network hop and latency per call, CPU/memory per pod, a complex control plane to operate and upgrade, and **much harder debugging** — the proxy is now in every failure path.
- **mTLS `PERMISSIVE` mode accepts both plaintext and mTLS** — which is how "we have mTLS everywhere" is silently untrue. Move to `STRICT` and **verify**, don't assume.
- **Options:** Istio (most capable, most complex) · **Linkerd** (simple, fast Rust proxy, sane default) · Cilium (eBPF, no sidecar) · **Ambient mesh** (removes the per-pod sidecar) · Dapr (broader than a mesh — state, pub/sub, bindings) · AWS App Mesh.
- **Honest position for an interview:** "I'd adopt a mesh when we're polyglot, need uniform mTLS for compliance, or need traffic-shaping we can't get from libraries. For a .NET-only estate of ten services, Polly and OpenTelemetry give 80% of the value at 10% of the operational cost — and I'd say so."

---

## 3. Identity & Access Management

- **AuthN vs AuthZ — conflating them is this domain's central failure.** Authentication establishes *who*; authorization decides *whether this principal may do this to this object*. Most breaches are authorization failures on an authenticated user.
- **Authorization models:**
  | Model | Decides on | Good for | Weakness |
  |---|---|---|---|
  | **RBAC** | roles | simple, auditable, familiar | **role explosion** as exceptions accumulate |
  | **ABAC** | attributes (user, resource, environment) | fine-grained, contextual | hard to audit — "who can do X?" becomes a query |
  | **ReBAC** | relationships (Zanzibar/OpenFGA) | ownership, sharing, hierarchies | newer, needs a dedicated service |
- **Directory & federation:** LDAP/Active Directory (the enterprise source of truth) · **SAML** (entrenched in workforce SSO) · **SCIM** (automated user provisioning *and deprovisioning* between systems).
- **The JML (Joiner–Mover–Leaver) lifecycle — and deprovisioning is the actual hard problem.** Joining is easy because someone is blocked and asking. **Movers accumulate permissions from every previous role (privilege creep), and Leavers leave orphaned access nobody notices.** SCIM plus periodic access certification is the answer.
- **MFA and phishing resistance:** SMS (weak — SIM swap) < TOTP < push < **FIDO2/WebAuthn/passkeys (phishing-resistant, because the credential is bound to the origin)**. In finance, push for the workforce and FIDO2 for privileged access is the realistic target.
- **Segregation of Duties is a constraint over role *assignment*, not just role enforcement** — the same person must not be able to both create and approve a payment. **It's a graph problem**: you must detect conflicting combinations across *all* of a user's roles, including ones acquired transitively through groups.

**Privileged Access Management:**
- **Standing privileged access is the highest-leverage attack surface** — permanent admin rights are what turns a phished account into a breach.
- **JIT elevation:** request → approve → time-boxed grant → automatic expiry → full session recording. (Azure **PIM**, AWS IAM Identity Center + session policies.)
- **Break-glass is necessary and precisely dangerous** — it must exist for the day the IdP is down, so it needs a credential outside the normal path. Therefore: stored offline, **alarmed on any use**, and reviewed every time, or it silently becomes a standing back door.
- **Governance: certification vs drift** — access reviews are point-in-time; entitlements drift continuously between them. Continuous detection beats quarterly attestation, and rubber-stamped attestation is worse than none because it creates false assurance.
- **Zero Trust identity: continuous, contextual, per-request** — not a single login event. (See [[28-Security]] §5.)

---

## Top traps

1. Business logic in the gateway (rebuilding an ESB).
2. Gateway described as just a load balancer.
3. No plan for the gateway's own failure/monitoring.
4. Service mesh proposed for a small single-language estate.
5. Claiming mesh-wide mTLS while running `PERMISSIVE`.
6. Ignoring the mesh's latency and operational cost.
7. RBAC role explosion with no plan.
8. Deprovisioning treated as solved (it isn't — movers and leavers).
9. SoD checked per-role instead of across a user's full transitive role set.
10. Standing admin access, and unmonitored break-glass.

---

## 30-second answers

- **"Do you need a service mesh?"** → It depends almost entirely on how polyglot you are. A mesh gives uniform mTLS, retries, timeouts and telemetry without touching application code, which is decisive across five languages and compliance requirements. For a .NET-only estate of ten services, Polly and OpenTelemetry give most of that at a fraction of the operational cost, and the mesh adds a hop, a proxy in every failure path and a control plane to upgrade. I'd rather say "not yet, and here's the trigger" than adopt it by default.
- **"RBAC or ABAC?"** → RBAC by default because it's auditable — you can answer "who can approve payments?" directly, which is what a regulator asks. Its failure mode is role explosion once exceptions accumulate. ABAC handles context and fine granularity but makes that same audit question a query over policy, which is much harder to evidence. In practice I'd use RBAC for coarse capability plus a small number of attribute or relationship checks for resource ownership, rather than going fully ABAC.
- **"What's the hardest part of IAM?"** → Deprovisioning. Joining is easy because someone is blocked and asking loudly; movers quietly accumulate permissions from every previous role, and leavers leave orphaned access nobody notices for months. So SCIM-driven lifecycle automation from the HR source of truth, plus continuous detection of entitlement drift rather than quarterly attestation — because a rubber-stamped access review is worse than none, it manufactures assurance that isn't there.

---

**Go deeper:** `38-API-Gateway/`, `39-Service-Mesh/`, `40-IAM/` · **Related:** [[41-OAuth2-OIDC-JWT]], [[28-Security]], [[23-Kubernetes]], [[17-Microservices]]
