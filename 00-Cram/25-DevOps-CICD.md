# DevOps & CI/CD — Cram Sheet

> Tier 2 · Source: `25-DevOps/` + `26-CICD/` (8 modules, 5,155 lines) · Read: 14 min

---

## 1. Infrastructure as Code (Terraform)

- **HCL builds a resource dependency graph** and applies in dependency order, parallelising where it can. `depends_on` only for implicit relationships the graph can't see.
- **The state file is Terraform's source of truth** — a map from config to real resource ids. Two consequences:
  - **It persists secrets in plaintext** (any value that passed through a resource). Encrypt the backend, restrict access, treat state as a secret.
  - **Remote state + locking** (S3 + DynamoDB, or Azure Blob + lease) is mandatory for teams, or two applies corrupt each other.
- **Plan-time-only reconciliation — the headline divergence from Kubernetes/GitOps.** Terraform reconciles **when you run it**, not continuously. So **drift requires a proactive, scheduled `plan`** to detect; a Kubernetes controller would have corrected it automatically. Know this difference — it's the standard question.
- **Modules** for reuse, **workspaces** for environment multiplicity (though separate state files/directories per environment is usually clearer at scale).

---

## 2. Configuration & Secrets

- **Configuration taxonomy — three distinct kinds:** **build-time** (baked into the artifact) · **deploy-time** (environment-specific, supplied at deployment) · **runtime** (changeable without redeploy, e.g. feature flags). Confusing them is why people rebuild an artifact per environment.
- **Secrets are not configuration. The reference-not-value principle:** deployment manifests and config files carry a **reference** to a secret (a Key Vault URI, a Secrets Manager ARN), never the value. The value is resolved at runtime by an identity.
- **Delivery mechanics:** env var (simple; visible in a process dump and child processes) · mounted file (better; supports rotation via a CSI driver) · **direct SDK fetch with a managed identity (best — no secret ever at rest in your infrastructure)**.
- **Environment promotion: configuration moves by PR, not by hand.** Otherwise environments drift and "works in staging" stops meaning anything.
- **Rotation needs the two-secret overlap pattern:** issue the new secret, run both as valid, migrate consumers, then revoke the old. A big-bang rotation is an outage.

---

## 3. Release & Deployment

- **Deployment ≠ release — the foundational decoupling.** *Deploy* = code is on the servers. *Release* = users can see it. **Feature flags** are what separate them, and that separation is what makes continuous deployment safe.

| Strategy | Mechanism | Rollback | Cost |
|---|---|---|---|
| **Rolling** | replace instances in batches (K8s default) | slow (roll forward/back) | none |
| **Blue-Green** | two full environments, switch traffic | **instant** | 2× infra |
| **Canary** | 1% → 5% → 25% → 100%, automated analysis | fast, **bounded blast radius** | needs good metrics |
| **Feature flag** | deploy dark, enable per cohort | **instant, no deploy** | flag debt |

- **Rolling has no traffic isolation** — both versions serve simultaneously, so **both versions must be compatible with the same database schema.**
- **Canary needs automated analysis with an automatic abort** on error rate / latency / business metric — a human watching a dashboard is not a canary.
- **Database migrations during deployment: expand/contract.** Add nullable column → write both, read old → backfill → read new → stop writing old → drop. **Every deployment step must be independently reversible.**
- **Feature-flag debt is real** — flags need an owner and an expiry, or you accumulate untested code paths.

---

## 4. CI Pipeline Architecture

- **Pipeline-as-code** — the pipeline is a reviewed, versioned artifact in the repo, not clicks in a UI.
- **Stage ordering is fail-fast economics:** cheapest and most-likely-to-fail first. Lint → unit → build → SAST/SCA → integration → package → DAST/E2E.
- **Caching correctness is entirely a cache-key problem.** The key must include everything that affects the output (lock file hash, tool versions, OS, target framework). Too broad a key = stale/wrong artifacts; too narrow = no cache hits. **A wrong cache key is a correctness bug, not a performance one.**
- **Parallelisation:** fan out for speed, **fan in for correctness** — the gate must wait on all branches.
- **Monorepo vs polyrepo — the real problem is affected-project detection.** Monorepo: atomic cross-project changes, one version of truth, but you must compute what actually changed or every build is a full build. Polyrepo: simple per-repo builds, but cross-cutting changes require coordinated PRs and version bumps.
- **CI is a privileged, attackable surface** — it holds deploy credentials and runs untrusted code from PRs. **Never expose secrets to a fork PR**, use short-lived OIDC federation instead of static cloud keys, isolate runners, and pin third-party actions to a **commit SHA**, not a tag.

---

## 5. Test Strategy

- **The pyramid's shape is a deliberate cost/reliability trade**, not dogma: many fast unit tests, fewer integration, **very few E2E**. In microservices, **contract tests replace most integration tests**.
- **Flaky tests: detect, quarantine, fix — never ignore.** A flaky suite destroys trust, and a suite people re-run until green provides no signal. Track flakiness rate as a metric; quarantine automatically, with an owner and a deadline.
- **Balanced sharding, not naive splitting** — split by historical runtime, or your slowest shard sets the wall-clock.
- **Coverage is a proxy, not a quality measure.** High coverage with no assertions is worthless; **use it to find untested areas, never as a target** (Goodhart's law). Better signals: mutation testing, defect escape rate.
- **Test data isolation** — parallel runs sharing a database leak state into each other. Per-test schema/transaction rollback, or containerised per-shard databases.
- **Test doubles vs real dependencies is a fidelity/speed trade** — mocks are fast and always behave, which is exactly why they miss real failures. **Testcontainers** is the modern middle ground.

---

## 6. Artifacts & Reproducible Builds

- **Build once, promote the same artifact** through environments. **Rebuilding per environment means you never tested what you shipped.**
- **Digest is true identity** — `sha256:...`, not a tag. Tags are mutable.
- **Reproducible builds** — same source ⇒ byte-identical output. Sources of non-determinism to eliminate: timestamps, file ordering, absolute paths, embedded build ids, unpinned dependencies. **Dependency locking must pin the entire transitive graph.**
- **The retention-policy trap:** an aggressive retention policy deletes the artifact you need to roll back to, or the one an auditor asks for. Retention has **three simultaneous constraints** — storage cost, rollback availability, and compliance — and they conflict.

---

## 7. CD Orchestration & Governance

- **Environment promotion = same artifact, increasing blast radius.** Dev → Test → Staging → Prod, gates between.
- **Gates: automated verification wherever possible; human approval only where judgement is genuinely required.** A human gate that always approves is a bottleneck pretending to be a control — and it is exactly what auditors will (correctly) challenge.
- **Rollback must be symmetric, first-class and automatable** — not an improvised runbook at 3am. Practise it.
- **GitOps (pull) vs push-based CD:** GitOps continuously reconciles declared state from Git (drift is corrected, the cluster needs no inbound credentials); push-based pipelines are imperative and need cluster credentials in CI. **GitOps solves drift; it does not solve a wrong declaration.**
- **Emergency/hotfix paths are the governance blind spot** — the break-glass route that bypasses the gates. It must exist, be **logged, time-boxed, and reviewed after the fact**, or it quietly becomes the normal path.

---

## 8. DevSecOps

- **Shift left — scan at every stage, not one late gate:** pre-commit (secrets) → PR (SAST, SCA, IaC scan) → build (image scan, SBOM) → deploy (policy, signature verification) → runtime (drift, behaviour).
- **Policy-as-code** (OPA/Rego, Kyverno, Conftest) — declarative rules over structured input (a Terraform plan, a K8s manifest, a PR). Same rules in CI *and* at admission.
- **Supply chain: SBOM** (what's in it) · **SLSA** (provenance levels — how it was built) · **signing/attestation** (Sigstore/cosign) · verify signatures at admission.
- **One enforcement point is never enough** — CI can be bypassed, so enforce again at admission and at runtime.
- **Platform engineering / IDP:** the golden path. **Developer experience is the actual governance lever** — a secure default that is also the *easiest* option gets adopted; a standard that makes life harder gets routed around.

---

## DORA metrics (quote these)

**Deployment frequency · Lead time for change · Change failure rate · MTTR.** Elite: on-demand deploys, <1 day lead time, 0–15% CFR, <1 hour MTTR. Note that **speed and stability correlate positively** — the "move fast vs be safe" framing is empirically false, which is a strong thing to say.

---

## Top traps

1. Rebuilding an artifact per environment.
2. Secrets as values in manifests instead of references.
3. Terraform drift assumed to self-correct (it doesn't — plan-time only).
4. Terraform state not encrypted/locked.
5. Coverage as a target.
6. Flaky tests re-run instead of quarantined.
7. A cache key that doesn't capture all inputs.
8. Third-party CI actions pinned to a tag, not a SHA.
9. Secrets exposed to fork PRs.
10. Canary with no automated abort; human gate as theatre; unaudited break-glass.

---

## Interview Q&A — Lead / Principal

### Q1 · From fortnightly releases to continuous delivery *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"We release every two weeks, it takes a weekend, and about a third of releases need a hotfix. Fix it."*

**Answer.** The 33% change-failure rate and the fortnightly cadence are the same problem, not two — big batches fail more, and failing more makes people batch harder to amortise the pain. So the intervention is batch size, and everything else follows.

Sequence matters. First make releases **safe**, not frequent: automated tests people trust (which means fixing flakiness first — a suite that's re-run until green provides no signal), **build the artifact once and promote it** rather than rebuilding per environment, and make **rollback symmetric, automated and practised**, because teams batch releases when they're afraid, and the cure for fear is a rollback that provably works. Then **decouple deploy from release** with feature flags, so shipping code stops being the same event as exposing it. Then increase frequency, which at that point is safe rather than brave.

Database changes are usually the actual blocker and the reason the weekend exists: **expand–contract** so schema changes are backward-compatible across a rolling deploy, and migrations as a separate step with their own identity, never from application startup with replicas racing.

I'd measure with **DORA** — deployment frequency, lead time, change failure rate, MTTR — and use it to make the point that **speed and stability correlate positively**. The "move fast versus be safe" framing this team has absorbed is empirically false, and that's usually the conversation that unlocks the change.

**Why it lands.** Links batch size to failure rate, sequences safety before frequency, names the database as the real blocker, and uses DORA to break the speed-vs-safety myth.
**✗ Weak answer.** "Deploy more often" or "add more automated tests."
**↳ Follow-ups.** What's your first move in week one? How do you fix a flaky suite?

---

### Q2 · The pipeline is the attack surface *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"How would you secure our CI/CD pipeline?"*

**Answer.** I'd treat CI as production, because it holds credentials that can deploy to production and it executes untrusted code from pull requests — that combination makes it a higher-value target than most of what it deploys, and it's usually governed far more loosely.

Concretely: **no static cloud keys** — short-lived OIDC federation to the cloud provider, so there's no long-lived secret to leak. **No secrets available to fork PRs**, which is the standard exfiltration path. **Third-party actions pinned to a commit SHA, not a tag**, because tags move and a compromised upstream action runs with your credentials. **Isolated, ephemeral runners** so one job can't observe another. And **least privilege per pipeline** — the build job should not hold deploy credentials.

Then supply chain: **SBOM** per artifact so "where is this library" is a query not an investigation, **provenance/SLSA** attestation of how it was built, artifact **signing**, and — the part people skip — **verifying the signature at admission**, because enforcement only in CI is enforcement that can be bypassed. One gate is never enough; the same policy should run in the pipeline and at the cluster.

The framing I'd add: most organisations apply change control rigorously to application code and almost none to the pipeline definition, even though the pipeline can deploy anything. Pipeline-as-code under the same review requirements closes that gap.

**Why it lands.** "CI is production", specific controls including the fork-PR and SHA-pinning traps, verification at admission, and the governance asymmetry.
**✗ Weak answer.** "Store secrets in the CI secret store" — necessary, nowhere near sufficient.
**↳ Follow-ups.** What stops a malicious PR from stealing credentials? Who can change the pipeline definition?

---

### Quick-fire (30 seconds each)

- **"Blue-green or canary?"** → Canary for most things: bounded blast radius, real production traffic, and automated analysis with an abort — but it needs metrics good enough to decide on, and both versions run together so the schema must be compatible with both. Blue-green when I need an atomic cutover and instant rollback and can afford double infrastructure — a big-bang schema change or a risky framework upgrade. Either way the deeper answer is feature flags, because they decouple release from deployment entirely and roll back in seconds without a deploy.
- **"How do you do zero-downtime database migrations?"** → Expand–contract, spread over multiple releases. Add the new column nullable and deploy code that writes both but reads the old; backfill in batches watching lock contention; deploy code that reads the new; then in a later release stop writing the old and drop it. Each step is independently deployable and reversible, which matters because during a rolling deploy both versions are serving against the same schema simultaneously.
- **"How do you secure a CI/CD pipeline?"** → Treat CI as production, because it holds deploy credentials and runs untrusted PR code. No static cloud keys — short-lived OIDC federation. Third-party actions pinned to a commit SHA, not a tag, because tags move. No secrets available to fork PRs. Then supply chain: SBOM, provenance, signed artifacts, and signature verification enforced at admission — not only in CI, because CI can be bypassed. Policy-as-code so the same rules run in the pipeline and at the cluster.

---

**Go deeper:** `25-DevOps/01`–`04`, `26-CICD/01`–`04` · **Related:** [[23-Kubernetes]], [[24-Docker]], [[27-Observability]], [[28-Security]]
