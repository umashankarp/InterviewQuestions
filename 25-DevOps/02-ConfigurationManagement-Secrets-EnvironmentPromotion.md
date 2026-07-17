# Module 86 — DevOps: Configuration Management, Secrets & Environment Promotion

> Domain: DevOps | Level: Beginner → Expert | Prerequisite: [[01-InfrastructureAsCode-Terraform-State-Drift]] (IaC/state/drift), [[../23-Kubernetes/04-Configuration-Security-ConfigMaps-Secrets-RBAC-PodSecurity]] (ConfigMaps/Secrets/RBAC), [[../02-DotNet-AspNetCore/05-Configuration-Options-Pattern]] (application-side config consumption), [[../23-Kubernetes/08-Observability-Multicluster-GitOps]] (GitOps promotion), [[../21-AWS/02-IAM-Security-KMS-SecretsManager]] / [[../22-Azure/02-IAM-Security-EntraID-RBAC-KeyVault]] (cloud secret stores)

---

## 1. Fundamentals

**What**: Configuration management is the discipline of defining, storing, delivering, and changing every value a system needs that is *not* code: connection strings, endpoints, resource sizing knobs, feature toggles, and — as a specially-governed subset — **secrets** (credentials, keys, tokens). **Environment promotion** is the controlled movement of a release *and its configuration* through a sequence of environments (dev → test → staging → production), such that what was validated in one environment is provably what runs in the next.

**Why it exists**: The same build artifact must behave correctly in multiple environments (12-factor principle: *build once, configure per environment*). The moment configuration lives anywhere unmanaged — a hand-edited environment variable, a value someone set in a portal, a secret pasted into a pipeline variable — three failure classes appear: (1) **environment parity drift** ("works in staging" because staging was hand-tuned in ways production never received), (2) **secret sprawl** (credentials scattered across repos, CI variables, and laptops, unrotatable because nobody knows every copy), and (3) **unauditable change** (a production behavior change with no PR, no reviewer, no rollback point — exactly Module 85's out-of-band-change problem, one layer up the stack).

**When it matters**: From the second environment onward. A single-environment hobby app can hardcode; the moment staging exists, every configuration value needs a defined *source of truth*, a *promotion path*, and — for secrets — a *rotation story*.

**How (30,000-ft view)**: A layered model — an environment-agnostic artifact (container image, package) + per-environment declared configuration (values files, config stores) + secrets *referenced, never embedded* (the config says "read `db-password` from the secret store"; only the runtime identity can dereference it) + promotion executed as reviewed, versioned change (a PR that changes the production values file / config-store version), not as hand-editing.

---

## 2. Deep Dive

### 2.1 The Configuration Taxonomy — Build-Time vs Deploy-Time vs Runtime
Every configuration value belongs to exactly one binding time, and misclassifying it causes a characteristic failure. **Build-time** config (compiled-in defaults, framework wiring) requires a rebuild to change — anything environment-specific here breaks "build once" (an image with a baked-in staging URL *cannot* be promoted; the Docker domain's Module 82 `ARG` finding is this mistake plus a secrecy leak). **Deploy-time** config (environment variables, mounted files, Helm values — Module 78) binds when the process starts — the standard home for endpoints, sizing, and environment identity; changing it means a redeploy/restart, which is fine because deploys are the audited change mechanism. **Runtime** config (config services, feature flags, `IOptionsMonitor`-consumed reloadable values — Module 13) changes *without* restart — powerful and dangerous in proportion: it bypasses the deployment pipeline's gates, so it needs its own audit, rollout, and rollback discipline or it becomes the fastest unreviewed path to a production incident.

### 2.2 Secrets Are Not Configuration — the Reference-Not-Value Principle
The single load-bearing rule: **configuration may name a secret; it must never contain one.** A values file, ConfigMap, pipeline variable, or `appsettings.json` holds a *reference* (`keyvault://prod-vault/db-password`, an ExternalSecret pointing at AWS Secrets Manager) and only the runtime's identity (IRSA/Managed Identity/K8s ServiceAccount — Modules 58/66/76) can dereference it at start or on demand. This yields: rotation without code/config change (rotate in the store; consumers re-resolve), audit at the store (who read what, when), revocation by identity (cut one workload's access without touching others), and — critically — a git history that is *safe by construction*, because the repository never held the secret. The **secret-zero problem** remains: something must authenticate the workload to the secret store in the first place — solved by platform-issued identity (cloud workload identity, K8s projected ServiceAccount tokens), never by a bootstrap credential in config, which would just relocate the original problem.

### 2.3 Secret Delivery Mechanics — Injection Patterns and Their Trade-offs
Four delivery patterns, in rising sophistication: (1) **CI-injected variables** — the pipeline reads the store and passes values as env vars at deploy; simple, but the pipeline becomes a high-privilege secret broker and rotation requires redeploy. (2) **Platform-native sync** — External Secrets Operator / Secrets Store CSI driver materializes store-held secrets as K8s Secrets/mounted files, reconciling on an interval (an Operator in exactly Module 78's sense — continuously converging declared references to actual values); rotation propagates automatically, but the cluster now holds a synced copy governed by K8s RBAC (Module 76's base64-not-encryption caveat applies — etcd encryption and tight RBAC are prerequisites, not options). (3) **Direct SDK access** — the app calls the secret store itself (with caching and refresh); fewest copies, but every service takes a hard startup dependency on the store's availability (Module 13 §Advanced Q1's graceful-startup-failure design becomes mandatory). (4) **Dynamic secrets** (Vault's signature capability) — the store *mints* short-lived, per-workload credentials on demand (a database user valid for 1 hour, tied to a lease); a leaked credential expires in minutes and every credential is individually attributable — the strongest posture, at the cost of running and operating the most sophisticated machinery, plus consumers that must handle mid-life credential renewal.

### 2.4 Environment Promotion — Configuration Moves by PR, Not by Hand
The GitOps promotion model (Module 80) applied to configuration: each environment's config is a declared, versioned artifact (per-env values files or overlay directories in a config repo; or versioned/labeled entries in a config service), and promotion is a *diff you can read* — a PR copying/updating the target environment's declaration, reviewed and merged, then applied by the same pipeline/controller machinery every time. Two structural rules make this honest. First, **parity by construction**: environments share a common base with explicit, minimal per-env deltas (Helm base values + small `values-prod.yaml`; Kustomize base + overlays) so the *difference between staging and production is a short, reviewable file* — the anti-parity failure mode is per-env forks that silently diverge until "staging validates nothing." Second, **the artifact is immutable across promotion**: the image digest validated in staging is byte-identical in production (promote by digest, not by rebuilding from the same tag — a rebuild is a different artifact, whatever the tag says).

### 2.5 Configuration Drift Between Environments — Module 85's Lesson, One Layer Up
Terraform's drift problem (out-of-band infrastructure changes persisting invisibly, §85-2.3) recurs identically for configuration: a value set by hand in a portal, a `kubectl edit` on a ConfigMap (reverted by the next Helm upgrade — Module 78's exact incident mechanism), an environment variable added to one environment's deployment "temporarily." Detection requires the same two-part answer as Module 85: (1) a *single declared source of truth* per environment (the config repo / labeled config-service version), and (2) *continuous or scheduled reconciliation* against it — GitOps controllers give configuration the continuous version (drift auto-reverts — with Module 80's caveat that enforcement of a *wrong* declaration is just as faithful); anything outside GitOps needs scheduled drift audits (diff running config against declared). The strongest posture makes out-of-band change *impossible* rather than detectable: RBAC that denies humans direct write access to production config objects, leaving the pipeline/controller as the only writer.

### 2.6 Rotation, Expiry & the Two-Secret Overlap Pattern
Rotation fails in production not at the store but at the *consumers*: the store has the new value while some consumer caches the old one (a connection pool re-authenticating with a dead password mid-life). The universally-applicable fix is **dual-secret overlap**: the target system honors two credentials simultaneously (two valid API keys, two DB passwords via paired users, current+next signing keys in a JWKS); rotation updates the *secondary*, consumers migrate on their natural refresh cadence, then the old primary is retired — no propagation race can hit a dead credential because both are valid throughout the window. Corollaries: consumers must *re-resolve secrets on auth failure* (one retry through "re-fetch from store" converts most rotation races into a blip), TTLs on cached secrets must be shorter than rotation overlap windows, and rotation must be *drilled* (a rotation that has never been executed is a plan, not a capability — the same "declared ≠ verified" discipline Modules 74–85 established, applied to credentials).

---

## 3. Visual Architecture

### The Promotion Pipeline — One Artifact, Layered Config, Reviewed Deltas
```
        BUILD (once)                    PROMOTE (by PR, per environment)
┌──────────────────────┐   ┌───────────────────────────────────────────────────┐
│ git tag v1.4.2       │   │ config repo:                                      │
│  → image sha256:abc… │   │   base/values.yaml         (shared declaration)   │
│  (env-agnostic:      │   │   envs/staging/values.yaml (small delta)          │
│   no URLs, no        │   │   envs/prod/values.yaml    (small delta)          │
│   secrets baked in)  │   │                                                   │
└──────────┬───────────┘   │ PR: "promote v1.4.2 to prod" = digest bump +      │
           │               │      any config delta — a human-readable diff     │
           ▼               └────────────────────┬──────────────────────────────┘
   registry (digest-addressed)                  │ merge
           │                                    ▼
           │                     GitOps controller / pipeline applies
           │                                    │
           ▼                                    ▼
   ┌─ staging ──────────┐            ┌─ production ────────┐
   │ sha256:abc…        │  same      │ sha256:abc…         │   secrets NEVER in
   │ + staging values   │  digest ►  │ + prod values       │   this flow — only
   │ + secret REFERENCES│            │ + secret REFERENCES │   references
   └────────────────────┘            └─────────┬───────────┘
                                               │ dereferenced at runtime by
                                               ▼ workload identity only
                                     ┌─ secret store ──────┐
                                     │ Vault / ASM / KV     │ ← rotation happens
                                     │ (audit, versions,    │   HERE, once, with
                                     │  leases, RBAC)       │   dual-secret overlap
                                     └──────────────────────┘
```

### Secret Delivery Patterns — Where the Copies Live (§2.3)
```
(1) CI-injected:      store → pipeline → env vars        (pipeline = high-privilege broker)
(2) Operator-synced:  store → ESO/CSI → K8s Secret/file  (reconciled copy in cluster)
(3) Direct SDK:       store → app (cached, refreshed)    (no intermediate copy; hard dep)
(4) Dynamic:          store MINTS per-workload, short-TTL credential (lease + renewal)
     fewer copies / stronger guarantees ───────────────────────────────► more machinery
```

---

## 4. Production Example

**Scenario**: A payments platform promoted release v2.9 from staging (two weeks of successful soak testing) to production. Within minutes, production began rejecting a specific card-network's transactions. Staging had processed the identical build flawlessly. **Investigation**: The card-network integration required a TLS client certificate and a gateway endpoint override. Three months earlier, during an urgent staging test, an engineer had set the endpoint override *directly as an environment variable in staging's deployment* via `kubectl set env` — an out-of-band change (§2.5) that existed in no values file. Staging "worked" because it carried invisible hand-applied configuration; the promotion PR faithfully promoted everything *declared* — and the override wasn't declared. **Root cause**: environment parity existed in the declared configuration but not in the *actual* configuration; staging validated a configuration state production would never receive. The out-of-band change also survived every intervening deploy because that deployment's Helm chart didn't manage that env var at all (Module 78's one-shot, non-reconciling gap — nothing ever reverted it, so nothing ever *surfaced* it either). **Fix**: (1) the override was added to the base values file (it was needed in *all* environments — the delta wasn't even legitimately environmental); (2) production-namespace RBAC was tightened to remove human `patch/update` on Deployments/ConfigMaps, making the pipeline the only writer; (3) a scheduled parity audit was added diffing each environment's *running* pod spec/env against its declared rendering, alerting on any unmanaged variable. **Lesson**: this course's cross-domain "declared ≠ actual" pattern (Modules 74/75/76/78/79/81/82/84/85) has a promotion-specific corollary — **staging only validates production if staging's *actual* state is its *declared* state**; every out-of-band convenience change silently converts your staging environment from a validator into a liar.

---

## 5. Best Practices
- Keep the artifact environment-agnostic and promote by **digest**; every environment-specific value enters via declared, per-env configuration (§2.1, §2.4).
- Enforce **reference-not-value** for secrets everywhere a human or git can see: repos, values files, pipeline variables, ConfigMaps (§2.2) — backed by pre-commit/CI secret scanning as the safety net for the rule's violations.
- Structure per-env config as **base + minimal explicit deltas**, and treat any growth in the delta files as an architecture smell to review (§2.4).
- Remove human write access to production config objects; the pipeline/GitOps controller is the sole writer, making out-of-band drift structurally impossible rather than merely detectable (§2.5).
- Design every secret for rotation from day one: dual-secret overlap support, consumer re-resolve-on-auth-failure, and a *scheduled rotation drill* per credential class (§2.6).
- Give runtime-changeable configuration (feature flags, reloadable options) its own audit trail, staged rollout, and rollback path — it bypasses the deploy pipeline's gates, so it must replicate their guarantees (§2.1).

## 6. Anti-patterns
- Hand-applied environment changes (`kubectl set env`, portal edits, SSH-and-edit) that exist in no declaration — the §4 incident's root cause, and Module 85's drift problem re-created one layer up (§2.5).
- Rebuilding "the same" artifact per environment instead of promoting one digest — the staging-validated artifact and the production artifact are then merely *probably* identical (§2.4).
- Secrets in git history, pipeline variable *values*, Helm values files, or baked into images (Modules 81/82's leak mechanisms) instead of references to a store (§2.2).
- Per-environment config forks (full copied files per env) instead of base+delta — divergence accumulates silently until staging validates nothing (§2.4).
- A "rotation procedure" that has never been executed against production — a declared capability with unverified actual behavior, this course's recurring failure shape applied to credentials (§2.6).
- One shared credential used by every service and environment ("the DB password") — unrotatable in practice because its blast radius is everything, and unattributable in audit because everyone is the same principal (§2.3).

---
