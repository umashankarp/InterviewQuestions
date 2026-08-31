# Module 76 — Kubernetes: Configuration & Security — ConfigMaps, Secrets, RBAC, Pod Security & Admission Controllers

> Domain: Kubernetes | Level: Beginner → Expert | Prerequisite: [[02-Networking-Services-Ingress-CNI-DNS-NetworkPolicies]] (§Advanced Q7 explicitly predicted this module's central finding — Pod Security Admission's enforcement-mode gap as a structural recurrence of NetworkPolicy's enforcement gap; this module confirms and details it), [[../21-AWS/02-IAM-Security-KMS-SecretsManager]] and [[../22-Azure/02-IAM-Security-EntraID-RBAC-KeyVault]] (Kubernetes RBAC is a genuinely SEPARATE authorization layer from cloud IAM — both must be independently reasoned about for any EKS/AKS workload)

---

## 1. Fundamentals

### Why does a Principal Engineer need Kubernetes-specific configuration/security depth when Modules 58 and 66 already established cloud IAM and secrets-management discipline?
Kubernetes RBAC governs access to the **Kubernetes API** — who/what can create a Pod, read a Secret, or modify a Deployment — while cloud IAM governs access to **cloud resources** (an S3 bucket, a Cosmos DB account) — these are two genuinely **separate, independently-configured authorization systems**, and a workload running on EKS/AKS is governed by both simultaneously, not one or the other. A Principal Engineer who only reasons about cloud IAM scoping (/66's territory) without equally rigorous Kubernetes RBAC scoping has secured only half of the actual permission surface a compromised or misconfigured workload could exploit — and the reverse is equally true. Additionally, Kubernetes's own configuration primitives (ConfigMaps, Secrets) have specific, easily-misunderstood security properties — most critically, that a Kubernetes `Secret` object's "encoding" is not, by itself, encryption — that don't have a direct, obvious analog in the cloud-IAM material already covered.

### Why does this matter?
Because a Principal Engineer is expected to secure the **full** permission surface of a Kubernetes-hosted workload — both what it can do to the Kubernetes API (RBAC) and what it can do to cloud resources (IAM) — and to correctly distinguish genuine secret protection (encryption at rest, tightly-scoped access) from the *appearance* of protection a default Kubernetes `Secret` object provides on its own.

### When does this matter?
For any Kubernetes cluster running more than a single, fully-trusted workload — RBAC's blast-radius-limiting value (like any least-privilege system/66) scales with the number of distinct workloads/teams/ServiceAccounts sharing a cluster, and Secret-handling discipline matters for any cluster storing genuinely sensitive data (API keys, database credentials, certificates) as native Kubernetes Secrets.

### How does it work (30,000-ft view)?
```
ConfigMap: non-sensitive configuration data, decoupled from container images
Secret: base64-ENCODED (NOT encrypted by default) sensitive data -- requires
 explicit etcd encryption-at-rest configuration for genuine protection
RBAC: Roles/ClusterRoles (WHAT actions are permitted) + RoleBindings/ClusterRoleBindings
 (WHO/WHAT is granted them) -- governs the KUBERNETES API specifically, a SEPARATE
 system from cloud IAM (/66)
ServiceAccount: the identity a Pod actually authenticates to the K8s API as -- can be
 federated to a cloud IAM role (IRSA on EKS, Workload Identity on AKS)
Pod Security Admission (PSA): per-namespace Pod-spec restriction (privileged/baseline/
 restricted levels) -- has THREE independent enforcement modes (enforce/audit/warn),
 and only "enforce" actually blocks anything
Admission Controllers: the general, pluggable request-interception layer PSA is ONE
 specific instance of -- runs AFTER authentication/RBAC, BEFORE persistence to etcd
```

---

## 2. Deep Dive

### 2.1 ConfigMaps — Decoupling Non-Sensitive Configuration From Container Images
A **ConfigMap** holds non-sensitive configuration data (feature flags, connection strings for non-sensitive endpoints, application config files) as key-value pairs, consumable by Pods either as environment variables or as mounted volume files — directly implementing the twelve-factor-app principle of externalizing configuration from the container image itself, so the identical image can be promoted across environments (dev/staging/production) with only the referenced ConfigMap differing. A subtle but operationally important distinction: a ConfigMap consumed as **environment variables** does **not** automatically update a running Pod when the ConfigMap changes — the Pod must be explicitly restarted (commonly automated via a third-party controller like Reloader, which watches ConfigMaps/Secrets and triggers a rolling restart of dependent Deployments) — whereas a ConfigMap consumed as a **mounted volume** is eventually, automatically synced into the running Pod's filesystem by the kubelet on its own periodic sync interval (typically up to a minute or so of propagation delay, not instantaneous) — a Principal Engineer relying on "just update the ConfigMap" as a config-change deployment mechanism must know which consumption method a given workload uses, since the actual propagation behavior differs materially between them.

### 2.2 Secrets — Base64 Encoding Is Not Encryption; etcd Encryption-at-Rest Is a Separate, Often-Missing Configuration Step
A Kubernetes `Secret` object stores its data **base64-encoded**, not encrypted — base64 is a reversible encoding scheme, not a cryptographic protection, meaning anyone with read access to the Secret object (via `kubectl get secret -o yaml`, or via direct etcd access) can trivially decode it back to plaintext with a single command. Genuine at-rest protection for Secrets requires a **separate, explicit** cluster configuration step — **etcd encryption at rest** (an `EncryptionConfiguration` resource specifying an encryption provider, commonly integrated with a cloud KMS — directly the AWS KMS or the Azure Key Vault, now protecting the Kubernetes control plane's own persisted data specifically) — that is **not enabled by default** on many clusters, particularly self-managed or default-configured ones; without it, a Secret object is, in practice, no more protected than a base64-encoded ConfigMap, despite superficially appearing to be a distinct, security-purpose-built object type. The more robust, increasingly standard production pattern avoids storing genuinely sensitive values as native Kubernetes Secrets at all: the **External Secrets Operator**, the **AWS Secrets Manager and Config Provider CSI driver**, or the **Azure Key Vault Provider for Secrets Store CSI Driver** instead dynamically fetch secret values directly from the Secrets Manager or the Key Vault at Pod-mount time, keeping the actual secret value's system of record in the cloud-native secrets service (with its own genuine encryption, rotation, and access-audit capabilities) rather than duplicating it into etcd at all.

### 2.3 RBAC — Roles and RoleBindings Govern the Kubernetes API, a Genuinely Separate System From Cloud IAM
Kubernetes RBAC has two paired concepts: a **Role** (namespace-scoped) or **ClusterRole** (cluster-scoped) declares a set of permitted **verbs** (get, list, create, delete, etc.) against specific **resources** (pods, secrets, deployments) — purely a *permission definition*, granting nothing on its own; a **RoleBinding** or **ClusterRoleBinding** actually *grants* a Role/ClusterRole's permissions to a specific subject (a User, Group, or ServiceAccount) — this Role/RoleBinding separation mirrors/66's policy-vs.-assignment distinction (an IAM policy document vs. its attachment to a role/user) at the Kubernetes-API-authorization layer specifically. The critical point this module establishes: **RBAC and cloud IAM are two entirely independent authorization systems governing two entirely different resource universes** — a ServiceAccount's RBAC permissions determine what it can do *to the Kubernetes API* (list Secrets, create Pods, delete Deployments), while a workload's cloud IAM role (via IRSA/Workload Identity) determines what it can do *to cloud resources* (read an S3 object, write to a Cosmos DB container) — a workload with an extremely tightly-scoped cloud IAM role but an overly-broad, cluster-admin-equivalent RBAC grant is still able to, for instance, read every Secret in the cluster (including other workloads' cloud credentials, a lateral-movement risk) — and the reverse gap (tight RBAC, loose cloud IAM) is equally real and independently exploitable; a Principal Engineer's security review must explicitly evaluate **both** dimensions, since scrutinizing only the one already covered by Modules 58/66 leaves the other entirely unreviewed.

### 2.4 ServiceAccounts — the Identity a Pod Actually Presents to the Kubernetes API, and Its Federation to Cloud IAM
Every Pod authenticates to the Kubernetes API as a **ServiceAccount** — if none is explicitly specified, the Pod runs as its namespace's `default` ServiceAccount, which (particularly on older or unhardened clusters) may carry broader-than-intended, automatically-mounted API credentials by default, a genuine, easily-overlooked over-permissioning risk directly analogous to the "avoid the default, overly-broad role" discipline, now at the Kubernetes-identity layer. Separately, a ServiceAccount can be **federated** to a cloud IAM identity — EKS's **IRSA (IAM Roles for Service Accounts)**, the exact mechanism, or AKS's **Workload Identity federation**, the analogous mechanism — via a ServiceAccount annotation mapping it to a specific cloud IAM role/Managed Identity, meaning a single ServiceAccount object is simultaneously the anchor for **both** authorization systems this module distinguishes: its RBAC bindings govern Kubernetes-API access, and its IRSA/Workload-Identity federation governs cloud-resource access — a Principal Engineer reviewing a ServiceAccount's total permission surface must trace **both** relationships explicitly, since reviewing only its RBAC bindings or only its federated cloud role independently misses half the actual access it has been granted.

### 2.5 Pod Security Admission — the Predicted Recurrence of the Enforcement-Mode Gap, Now Confirmed
 §Advanced Q7 explicitly predicted this finding by structural analogy before this module covered it in detail: **Pod Security Admission (PSA)** restricts what a Pod spec is permitted to declare, at three increasingly strict levels — **privileged** (no restrictions), **baseline** (blocks known privilege-escalation vectors — host namespace access, privileged containers), **restricted** (the most locked-down, enforcing current Pod-hardening best practices — no privilege escalation, mandatory non-root, restricted volume types) — applied per-namespace via labels. The confirmed recurrence: PSA has **three independent enforcement modes** — `enforce` (actually blocks non-compliant Pod creation), `audit` (allows the Pod, but logs a violation to the audit log), `warn` (allows the Pod, but returns a warning to the client, e.g., visible in `kubectl` output) — and a namespace configured with only `audit` or `warn` mode (a common, reasonable-sounding *intermediate* step during a gradual security-hardening rollout — "let's see what would be blocked before we actually block anything") provides **zero actual blocking protection**, identical in structure to the NetworkPolicy enforcement gap: the namespace label is present, syntactically valid, and visibly configured, while a genuinely privileged, host-mounting container can still be created in that namespace without any actual obstruction — the audit/warn output exists, but only for anyone actively watching for it, not as an enforced control.

### 2.6 Admission Controllers — the General Mechanism Pod Security Admission Is One Specific Instance Of
**Admission controllers** are the general, pluggable request-interception layer in the Kubernetes API request lifecycle, running **after** authentication and RBAC authorization succeed, but **before** the object is actually persisted to etcd — meaning an admission controller can still reject, or **mutate**, a request that has already passed identity and permission checks. Pod Security Admission is one specific, built-in **validating** admission controller; **mutating** admission webhooks (which can modify a request, e.g., automatically injecting a sidecar container — directly how Istio's sidecar injection, relevant, actually works mechanically) and **validating** admission webhooks (which can only allow/deny, e.g., **OPA/Gatekeeper** or **Kyverno**, the common policy-as-code engines enforcing organization-specific governance rules beyond Kubernetes's built-in PSA levels — "every Deployment must declare resource requests/limits," "no image may be pulled from an unapproved registry") extend this same mechanism arbitrarily — a Principal Engineer designing organization-wide Kubernetes governance (directly this course's recurring automated-governance-gate theme,/72's synthesized pattern) should recognize custom admission webhooks, not documentation or manual review alone, as the structurally correct mechanism for **enforcing** (not merely documenting) cluster-wide policy, provided — per the confirmed lesson — that any such webhook's actual failure/enforcement mode is explicitly verified, not merely assumed correct from its presence.

---

## 3. Visual Architecture

### Two Independent Authorization Systems Governing One Workload
```mermaid
graph TB
 SA["ServiceAccount: checkout-api"]
 SA -->|"RBAC RoleBinding<br/>(governs K8s API access)"| RBAC["Role: pod-reader<br/>-- can list/get Pods, NOTHING about cloud resources"]
 SA -->|"IRSA / Workload Identity annotation<br/>(governs CLOUD resource access)"| CloudIAM["AWS IAM Role / Azure Managed Identity<br/>-- can read S3 bucket, NOTHING about K8s API"]
 Note["A gap in EITHER system is independently exploitable --<br/>tight cloud IAM does NOT compensate for loose RBAC, and vice versa"]
```

### Admission Controller Request Flow, and PSA's Three Enforcement Modes
```mermaid
graph LR
 Req["kubectl apply<br/>(Pod creation request)"] --> Auth["Authentication"]
 Auth --> RBACCheck["RBAC Authorization"]
 RBACCheck --> Admission["Admission Controllers<br/>(Mutating, then Validating --<br/>PSA, OPA/Gatekeeper, Kyverno)"]
 Admission -->|"enforce mode: BLOCKED"| Rejected["Request REJECTED"]
 Admission -->|"audit/warn mode: LOGGED ONLY"| Etcd["Persisted to etcd --<br/>privileged Pod now RUNNING"]
```

## 4. Production Example
**Scenario**: A platform team began a security-hardening initiative to adopt Pod Security Admission's `restricted` level across all production namespaces, following the widely-recommended, cautious rollout pattern: configure `pod-security.kubernetes.io/enforce-version` alongside setting the enforcement mode to `audit` and `warn` first, deliberately deferring `enforce` mode until the resulting audit logs confirmed no existing workload would actually be broken by the new restriction. This was documented, reviewed, and tracked as a two-phase rollout — phase one (audit/warn, to gather data with zero production risk) followed by phase two (switching to enforce, once the audit data confirmed safety). **Investigation**: phase one completed cleanly — the audit logs showed no existing workloads would be blocked by the `restricted` policy — but phase two, the actual switch to `enforce` mode, was never executed: the engineer who owned the initiative moved to a different team shortly after phase one's completion, the tracking ticket for phase two was left open but unprioritized amid other work, and the platform team's own dashboards showed the PSA labels present on every production namespace, which — reviewed only superficially — appeared to indicate the security control was fully active. Nine months later, a routine security review (unrelated to the original initiative) discovered a workload running a genuinely privileged, host-filesystem-mounting container in a "restricted" namespace, and tracing back the finding revealed the enforcement mode had remained `audit`/`warn` the entire time. **Root cause**: this is a direct, real-world instance §Advanced Q7's predicted recurrence — the namespace labels' mere presence (visible on a dashboard, in `kubectl get namespace --show-labels`) was mistaken for evidence of active enforcement, exactly the "object presence provides zero evidence of runtime effect" pattern this course has now identified across NetworkPolicy, reclaim policy, and Pod Security Admission (this module) — compounded by an organizational gap (an unfinished, abandoned two-phase rollout with no forcing function to complete phase two) structurally similar to the "known lesson doesn't propagate without structural enforcement" finding. **Fix**: completed the deferred phase-two switch to `enforce` mode across all production namespaces, and — as the durable, structural fix — added an automated, recurring check (directly extending this course's now-repeated "automated verification, not object-presence trust" pattern) that specifically flags any namespace whose PSA labels indicate `audit`/`warn`-only mode for longer than a defined grace period, forcing explicit, tracked completion of any gradual-rollout pattern rather than allowing an indefinitely-stalled intermediate state to silently persist. **Lesson**: gradual, audit-then-enforce rollout patterns are a genuinely sound *methodology* — deliberately verifying a new restriction won't break existing workloads before actually enforcing it is good practice, not the mistake here — but any such staged rollout is only safe if phase transitions are **tracked and time-boxed with an explicit, monitored deadline**, not left as an indefinitely-deferrable "phase two" with no forcing function; the specific, structural failure mode this incident demonstrates is an *abandoned migration*, a category this course has now encountered in several different guises (an incomplete Well-Architected remediation, an unmigrated shared IAM role) and which reliably recurs whenever a security improvement is staged in a way that looks complete before it actually is.
## 10. Interview Questions

### Basic (10)
1. **Q: What does a ConfigMap store, and what should never be stored in one?** **A:** Non-sensitive configuration data — sensitive values (credentials, API keys) belong in a Secret (or, more robustly, an external secrets manager), never a ConfigMap.
2. **Q: Is a Kubernetes Secret's data encrypted?** **A:** Not by default — it's base64-encoded, a reversible encoding, not encryption; genuine at-rest protection requires separately configuring etcd encryption at rest.
3. **Q: What is the difference between a Role and a RoleBinding?** **A:** A Role defines a set of permitted actions (verbs/resources); a RoleBinding actually grants that Role's permissions to a specific subject (User, Group, or ServiceAccount).
4. **Q: Is Kubernetes RBAC the same system as cloud IAM (AWS IAM/Azure RBAC)?** **A:** No — RBAC governs access to the Kubernetes API; cloud IAM governs access to cloud resources. They are two independent authorization systems.
5. **Q: What identity does a Pod use to authenticate to the Kubernetes API?** **A:** A ServiceAccount — its own `default` ServiceAccount if none is explicitly specified.
6. **Q: What mechanism federates a Kubernetes ServiceAccount to a cloud IAM role?** **A:** IRSA (IAM Roles for Service Accounts) on EKS, or Workload Identity federation on AKS.
7. **Q: What are the three Pod Security Admission levels?** **A:** Privileged (no restrictions), baseline (blocks known privilege-escalation vectors), and restricted (the strictest, enforcing current Pod-hardening best practices).
8. **Q: What are the three Pod Security Admission enforcement modes, and which one actually blocks a non-compliant Pod?** **A:** `enforce` (blocks), `audit` (logs but allows), `warn` (returns a warning but allows) — only `enforce` actually blocks.
9. **Q: What is an admission controller, and when does it run in the request lifecycle?** **A:** A pluggable request-interception mechanism that runs after authentication and RBAC authorization, but before the object is persisted to etcd — able to reject or mutate the request.
10. **Q: What did the incident reveal about the team's staged Pod Security Admission rollout?** **A:** Phase one (audit/warn mode) completed, but phase two (switching to enforce) was never executed due to an ownership change — the namespace labels' presence was mistaken for active enforcement for nine months.

### Intermediate (10)
1. **Q: Why is "the namespace has PSA labels configured" insufficient evidence that Pod-level restrictions are actually enforced?** **A:** PSA labels specify both a security level (privileged/baseline/restricted) and an independent enforcement mode (enforce/audit/warn) — labels alone don't indicate which mode is active, and only `enforce` mode actually blocks non-compliant Pods.
2. **Q: Why can a workload with a tightly-scoped cloud IAM role still pose a serious security risk if its RBAC permissions are overly broad?** **A:** Because RBAC governs an entirely separate resource universe (the Kubernetes API) — an overly broad RBAC grant lets that workload read other workloads' Secrets, modify Deployments, or otherwise act across the cluster, regardless of how narrowly its cloud IAM role restricts cloud-resource access.
3. **Q: Why does a ConfigMap consumed as environment variables require an explicit restart mechanism to pick up changes, while a volume-mounted ConfigMap eventually updates automatically?** **A:** Environment variables are set once, at container start, and never re-read afterward; a volume-mounted ConfigMap's files are periodically re-synced onto the Pod's filesystem by the kubelet, so a running process reading the file (not caching it in memory at startup) picks up the change on the next read after the sync interval.
4. **Q: Why is the External Secrets Operator / cloud-native Secrets Store CSI driver pattern described as more robust than storing production credentials as native Kubernetes Secrets?** **A:** It keeps the secret's actual system of record in the cloud-native secrets service (/66), which has genuine encryption, rotation, and access-audit capabilities, rather than duplicating the value into etcd where its protection depends entirely on whether etcd encryption at rest happens to be separately configured.
5. **Q: Why does this module describe the incident as "a direct, real-world instance" §Advanced Q7's prediction?** **A:** §Advanced Q7 predicted, by structural analogy to NetworkPolicy's enforcement gap, that a Pod Security Admission namespace with a misconfigured enforcement mode (audit/warn instead of enforce) would show policy objects present and valid while providing zero actual blocking enforcement — the incident is exactly this scenario occurring in practice.
6. **Q: Why is the two-phase audit-then-enforce PSA rollout pattern itself described as sound methodology, despite the incident?** **A:** Verifying a new restriction won't break existing workloads before actually enforcing it is good, cautious practice — the incident's actual failure was an *abandoned* migration (phase two never executed, with no tracked deadline), not a flaw in the staged-rollout methodology itself.
7. **Q: Why should a Pod's `default` ServiceAccount be treated with the same scrutiny as an over-permissioned IAM role?** **A:** Particularly on unhardened clusters, the `default` ServiceAccount may carry broader-than-intended, automatically-mounted API credentials — running workloads under it without review risks granting more Kubernetes-API access than that specific workload actually needs, the identical over-permissioning risk pattern this course established for cloud IAM defaults.
8. **Q: Why do mutating admission webhooks matter beyond policy enforcement, per the Istio example?** **A:** Mutating webhooks can modify a request before persistence — Istio's automatic sidecar injection (relevant) works mechanically via a mutating webhook that adds the Envoy sidecar container to a Pod spec, not merely validating an existing spec.
9. **Q: Why does a `ClusterRoleBinding` granting `cluster-admin` deserve the same severity treatment as a wildcard IAM policy?** **A:** Both grant maximal, essentially unrestricted permission within their respective authorization system — `cluster-admin` lets a compromised ServiceAccount read, modify, or delete any object in the cluster, including every other workload's Secrets, the Kubernetes-API-layer equivalent of an unrestricted cloud IAM policy's blast radius.
10. **Q: Why should custom admission webhook failure policy (`Fail` vs. `Ignore`) be treated as a genuine availability trade-off?** **A:** A webhook configured with `failurePolicy: Fail` that becomes unavailable will block all matching object creation cluster-wide until it recovers — trading stricter policy guarantee (nothing gets through unchecked) for a genuine availability risk if the webhook itself has any downtime.

### Advanced (10)
1. **Q: Diagnose the incident from first principles, and design the specific organizational/tooling structure that prevents any future staged security rollout (PSA, NetworkPolicy, or otherwise) from silently stalling in an incomplete, "looks done but isn't" state.**
 **A:** Root cause: an inherently sound staged-rollout methodology (audit-then-enforce) had no structural forcing function requiring phase two's completion, and the namespace labels' visible presence created a false impression of completeness that went unchallenged for nine months, compounded by the ownership handoff when the responsible engineer moved teams. Structural fix: (1) any staged security rollout must be tracked with an explicit, monitored completion deadline, not an open-ended ticket — directly extending this course's now-repeated "automated verification, not object-presence trust" pattern (Modules 74, 75) into a *process*-level requirement, not just a technical one; (2) an automated, recurring cluster-wide scan flagging any namespace/policy whose enforcement mode indicates an incomplete staged rollout (audit/warn without enforce) past a defined grace period, surfaced to a team-level owner, not an individual engineer, specifically so an ownership change doesn't cause the finding to be silently lost; (3) require explicit sign-off/verification (a positive confirmation, not merely ticket closure) that phase two's `enforce` transition actually occurred and was validated, mirroring §Advanced Q1's "structural enforcement, not just documentation" lesson now applied to internal security-rollout completion tracking specifically.
2. **Q: A team argues that since their EKS cluster already scopes every workload's cloud IAM role tightly via IRSA, Kubernetes RBAC is a secondary concern that can be left at broad, permissive defaults to reduce operational overhead. Evaluate this claim using the dual-system framing.**
 **A:** Push back directly — RBAC and cloud IAM are independent systems governing independent resource universes; a tightly-scoped IRSA role provides zero protection against a workload with broad RBAC permissions reading every Secret in the cluster (including other workloads' cloud credentials, enabling lateral movement to escalate privileges the compromised workload's own IRSA role wouldn't otherwise grant it), listing/deleting arbitrary Deployments, or otherwise acting across the cluster's Kubernetes-API surface — "we've secured cloud IAM" addresses only half of the actual permission surface, and leaving RBAC at permissive defaults specifically creates the lateral-movement risk this module's Secret-reading example demonstrates concretely.
3. **Q: Design the specific automated check that would have caught the incident well before the nine-month security review, extending this course's now-repeated "automated enforcement-mode verification" pattern from Modules 74/75 to Pod Security Admission specifically.**
 **A:** A scheduled job querying every namespace's PSA labels cluster-wide, cross-referencing the `enforce` mode's presence against a declared "should be fully enforced by [date]" tracking annotation set at rollout-initiation time — flagging (and paging an owning team, not merely logging) any namespace still lacking `enforce` mode past its declared target date; additionally, a periodic (not merely rollout-time) synthetic test — deliberately attempting to create a genuinely non-compliant test Pod (a privileged, host-mounting container) in a "restricted" namespace and asserting the creation is actually rejected — directly the same positive/negative connectivity-test discipline §Advanced Q3 established for NetworkPolicy, now applied to Pod Security Admission's actual blocking behavior specifically, since (per the incident) the presence of the correct labels alone was demonstrated to be an unreliable signal.
4. **Q: A workload's Pod spec passes Pod Security Admission's `restricted` level validation (no privileged containers, no host-namespace access) but the container image itself was pulled from an unapproved, unscanned public registry. Explain why PSA alone doesn't address this risk, and design the correct extension.**
 **A:** PSA's built-in levels validate Pod-spec-level properties (privilege escalation vectors, capabilities, volume types) — they have no built-in concept of image provenance, registry allow-listing, or vulnerability-scan status at all, meaning "passes PSA restricted" and "the image itself is trustworthy" are entirely independent claims; the correct extension is a **custom validating admission webhook** (OPA/Gatekeeper or Kyverno) with an explicit policy rejecting any Pod spec referencing an image from outside an approved registry allow-list, or requiring a passing vulnerability-scan attestation — directly demonstrating why PSA's built-in levels are necessary but not sufficient for comprehensive Pod-level governance, and why the general admission-controller mechanism (not PSA specifically) is the correct place to add organization-specific rules PSA's fixed levels don't cover.
5. **Q: Critique the following claim: "Since we've enabled etcd encryption at rest, our Kubernetes Secrets are now fully protected, and we no longer need to consider migrating to an external secrets manager."**
 **A:** Overstated — etcd encryption at rest protects against one specific threat (someone gaining direct access to etcd's underlying storage/backups and reading Secret data offline), but does **not** address: anyone with legitimate `get secret` RBAC permission still reads the (etcd-encrypted-but-API-decrypted-on-read) plaintext value directly via `kubectl`; Kubernetes Secrets have no native rotation mechanism (a value set once persists until manually changed, unlike Secrets Manager/Key Vault's automated-rotation capabilities,/66); and etcd-encrypted Secrets provide no centralized access-audit trail comparable to a dedicated secrets manager's access logging — etcd encryption at rest closes one specific gap (the core finding) but doesn't provide the fuller capability set (rotation, fine-grained audit, centralized management across both Kubernetes and non-Kubernetes consumers) an external secrets manager provides; the two aren't equivalent, and etcd encryption should be treated as a necessary baseline, not a complete substitute.
6. **Q: A ServiceAccount is granted a RoleBinding scoped to a specific namespace, and the team believes this fully contains its blast radius to that namespace alone. Identify the specific gap in this reasoning, connecting to the dual-relationship framing.**
 **A:** A namespace-scoped RoleBinding does correctly contain the ServiceAccount's **RBAC** blast radius to that namespace — but established that the *same* ServiceAccount may also carry a **separate**, cloud-IAM-federated identity (via IRSA/Workload Identity) whose permission scope is entirely independent of, and not contained by, any Kubernetes-namespace boundary at all — a namespace-scoped RBAC review alone says nothing about what that ServiceAccount's federated cloud IAM role permits it to do to cloud resources, which could span an entire AWS account or Azure subscription regardless of how tightly the Kubernetes-side RBAC is scoped; genuine blast-radius containment requires explicitly verifying both relationships independently, exactly as and Advanced Q2 establish.
7. **Q: Explain why this module's central recurring pattern — object/label presence being mistaken for active enforcement — has now appeared in three structurally distinct contexts across this domain (NetworkPolicy, reclaim policy, Pod Security Admission), and what this recurrence implies about how Kubernetes governance controls should generally be verified going forward.**
 **A:** Each instance shares the identical underlying structure: a Kubernetes control-plane object (a NetworkPolicy, a StorageClass's reclaim-policy field, a namespace's PSA label) is accepted, persisted, and displayed by the API without the API itself providing any signal about whether the *downstream, actual enforcement mechanism* (a CNI plugin, a CSI driver's deletion behavior, an admission controller's blocking mode) is genuinely active and correctly configured — Kubernetes's declarative object model faithfully represents *intent*, but intent and *enforced reality* are decoupled by design, since the actual enforcement is delegated to a separate, pluggable component the API server itself doesn't introspect. The general implication: any Kubernetes governance or security control relying on a pluggable downstream enforcer (rather than a control fully self-contained within the API server's own logic) requires an explicit, independent, ongoing verification test of actual runtime behavior — never trust in the declared object's presence or syntactic validity alone — a discipline this domain has now established as a standing methodology, not a one-off lesson specific to any single object type.
8. **Q: Design a Kubernetes-native governance program (synthesizing this module) for an organization that must demonstrate, for a compliance audit, that RBAC least-privilege is genuinely enforced across a large, multi-team cluster — not merely that Roles/RoleBindings exist.**
 **A:** (1) An automated, recurring RBAC-audit tool (e.g., `rbac-lookup`, or a custom equivalent) enumerating every effective permission grant per ServiceAccount cluster-wide, cross-referenced against each workload's actual, observed API usage (via audit logs) to identify granted-but-never-used permissions — a direct RBAC-layer analog to cloud IAM's access-analyzer/unused-permission-detection tooling. (2) A mandatory admission-webhook-enforced policy rejecting any new `ClusterRoleBinding` granting `cluster-admin` without an explicit, documented exception (the severity framing operationalized as a structural gate, not a review-time observation alone). (3) A periodic, positive-and-negative test suite (Advanced Q3's pattern) verifying specific expected-deny scenarios (a workload's ServiceAccount should NOT be able to read a different namespace's Secrets) actually fail as expected, not merely that the RBAC objects exist with the intended structure. (4) Documented evidence of both dimensions — RBAC audit results AND cloud-IAM audit results (already required by/66's own governance program) — presented together for any given workload, since a compliance auditor evaluating only one dimension would, per this module's core finding, miss half the actual access-control picture.
9. **Q: A workload needs to read Secrets from multiple namespaces for a legitimate cross-namespace configuration-aggregation use case. Design the RBAC configuration that satisfies this requirement while minimizing the blast-radius risk describes for over-broad ClusterRole grants.**
 **A:** Avoid a single `ClusterRole` + `ClusterRoleBinding` granting cluster-wide Secret-read access (which would grant access to *every* namespace's Secrets, including ones with no legitimate relationship to this workload's actual requirement) — instead, define a namespace-scoped `Role` permitting `get`/`list` on Secrets, and create individual `RoleBinding`s in **only** the specific namespaces the workload genuinely needs to read from, binding the same ServiceAccount identity in each — this achieves the required cross-namespace access while keeping the actual granted scope explicitly enumerable and auditable (a reviewer can see precisely which namespaces are included, rather than an unbounded "all of them"), directly the same least-privilege, explicitly-scoped-rather-than-broadly-granted discipline/66 established for cloud IAM, now applied via Kubernetes's namespace-scoped RBAC primitives specifically.
10. **Q: As a Principal Engineer establishing Kubernetes configuration/security standards for a platform team about to onboard multiple tenant teams onto a shared cluster, design the specific set of standing architectural decisions and automated governance checks (synthesizing this entire module) required before multi-tenant production onboarding.**
 **A:** (1) Mandatory etcd encryption at rest, verified (not merely configured-and-assumed) via a periodic check confirming the encryption provider is actually active. (2) A migration plan moving genuinely sensitive production credentials off native Kubernetes Secrets and onto an External-Secrets-Operator/CSI-driver-backed pattern for any newly onboarded tenant. (3) A mandatory, per-tenant RBAC least-privilege review distinct from and in addition to each tenant's cloud IAM review (Advanced Q8's audit-tool design), with both dimensions' results documented together (Advanced Q6). (4) Cluster-wide Pod Security Admission set to `restricted` `enforce` mode as the default baseline for all tenant namespaces, with any staged/gradual exception rollout for a specific legacy tenant workload tracked with the explicit, monitored deadline structure Advanced Q1 establishes — never an open-ended audit/warn-only state. (5) Custom admission-webhook-enforced policies (image-registry allow-listing, mandatory resource requests/limits/Advanced Q4) covering the governance requirements PSA's fixed levels don't address, with each webhook's own failure-mode behavior explicitly reviewed for availability impact. (6) Recurring, automated positive-and-negative verification tests for every layered control this domain has established (NetworkPolicy enforcement, reclaim policy, PSA enforcement mode, RBAC deny-scenarios) — the single, unifying structural lesson this entire `23-Kubernetes` domain has repeatedly surfaced: a Kubernetes governance control's declared presence is never sufficient evidence of its actual, enforced effect.

### Expert (10)
1. **Q: A payments platform's PCI-DSS audit finds that a namespace correctly enforces Pod Security Admission `restricted`/`enforce`, yet an auditor demonstrates reading a live database credential from inside a running, fully PSA-compliant Pod via `kubectl exec`. Explain why PSA compliance didn't prevent this, using §8.3.**
 **A:** PSA evaluates a Pod *spec* at admission time only — it constrains what a Pod is allowed to *declare* (no privileged containers, no host access, mandatory non-root), not what an RBAC-authorized identity can subsequently *do* once that compliant Pod is already running; `kubectl exec` access is governed entirely by RBAC's `pods/exec` sub-resource permission, a completely separate control PSA has no visibility into at all. The audit finding reveals a missing *third* control, not a PSA misconfiguration: `pods/exec` (and `pods/portforward`) must be independently, tightly RBAC-scoped, treated with the same severity as direct Secret-read access, since it provides an equivalent path to any data or credential accessible from inside a running container.

2. **Q: Critique the claim: "Our RBAC review tooling confirmed no Role in the cluster grants `verbs: ["*"]` on `secrets`, so we have no wildcard-permission risk." Identify the specific gap, extending §8.2.**
 **A:** This check is necessary but not sufficient — a Role granting `verbs: ["*"]` on `resources: ["*"]` (a full cluster-admin-equivalent wildcard) technically also satisfies "no Role grants `verbs: ["*"]` on `secrets` *specifically*" as a narrowly-worded query, since the wildcard's breadth means it was never enumerated as a `secrets`-specific rule at all; a genuinely correct audit must expand every wildcard (`apiGroups`, `resources`, `verbs`) to its full, effective resource/verb coverage before evaluating whether Secret access is included, not pattern-match on the literal string `"secrets"` appearing in the rule.

3. **Q: Design the specific test that would distinguish "our webhook's `failurePolicy: Fail` configuration is a deliberate, reviewed choice" from "our webhook is one outage away from blocking all Pod creation cluster-wide," synthesizing §9.3's capacity-planning concern.**
 **A:** A controlled load test deliberately scaling the webhook deployment's replica count to zero (or throttling it) during a simulated high-object-churn event (a large Deployment rollout in a test namespace) and confirming: (a) the resulting cluster-wide Pod-creation blockage is the *expected, understood* behavior, not a surprise; (b) the webhook's own horizontal scaling configuration (HPA, minimum replica count) is sized against the cluster's actual peak object-churn rate, not merely its steady-state rate; (c) an alert fires specifically on webhook unavailability *before* it manifests as widespread Pod-creation failures, giving on-call responders lead time rather than discovering the outage via a flood of unrelated-looking Deployment failures.

4. **Q: A team's External Secrets Operator instance is compromised via a supply-chain vulnerability in one of its dependencies. Using §9.2, explain why the blast radius depends entirely on an architectural decision made at initial rollout, not on anything discoverable at incident time.**
 **A:** If the platform chose a single, centrally-operated ESO instance with one broad, cross-tenant-scoped IAM role (the simpler-to-operate option), the compromise's blast radius is every tenant's secrets the backing cloud secrets manager contains — the incident-response team cannot retroactively narrow this scope at discovery time; if the platform instead chose per-tenant ESO instances or per-tenant `SecretStore` scoping (the more complex-to-operate option), the same compromise is contained to one tenant's secrets by construction. This is a direct illustration of why blast-radius-limiting architecture decisions must be made proactively, before any incident, since no amount of skillful incident response can add isolation boundaries that were never architecturally present.

5. **Q: Explain why disabling `automountServiceAccountToken` for a stateless web-frontend workload (§8.4) is a genuinely different mitigation layer than tightly scoping that workload's RBAC permissions, rather than a redundant, belt-and-suspenders duplicate.**
 **A:** RBAC scoping limits *what* the token can do if used; `automountServiceAccountToken: false` prevents the token from being present in the Pod's filesystem *at all* — for a workload with zero legitimate Kubernetes-API-calling need, the correct posture is removing the credential entirely, not merely narrowing its scope, since a narrowly-scoped-but-present token is still one dependency-confusion compromise away from being read and exfiltrated for use *outside* the Pod (from an attacker's own infrastructure, at any time until the token expires or is rotated) — a risk that not mounting the token at all eliminates structurally, independent of how tightly RBAC happens to be scoped.

6. **Q: Design the specific, automated check catching a `SecurityContext`-compliant, PSA-`restricted`-passing Pod spec that nonetheless grants itself `pods/exec` access to itself via an overly broad RBAC binding on its own ServiceAccount — synthesizing Expert Q1 into a governance-gate design.**
 **A:** A dedicated RBAC-audit rule (extending Advanced Q8's `rbac-lookup`-style tooling) specifically flagging any ServiceAccount whose effective permissions include `get`/`create` on the `pods/exec` sub-resource for Pods within its own namespace (or cluster-wide), cross-referenced against a data-classification label on that namespace — since PSA's own admission-time check has no visibility into this permission at all (Expert Q1), this must be a wholly separate, RBAC-specific check, run with the same periodic-audit rigor Advanced Q8 established for other RBAC risk categories, not folded into (or assumed covered by) the existing PSA-compliance verification.

7. **Q: A Principal Engineer is asked whether adopting mesh-level AuthorizationPolicy (relevant, if the service mesh module has been covered) makes this module's Kubernetes RBAC discipline less critical. Evaluate, synthesizing the independent-authorization-layers theme.**
 **A:** No — AuthorizationPolicy governs *mesh-aware, L7 service-to-service* traffic; Kubernetes RBAC governs the *Kubernetes API itself* (creating Pods, reading Secrets, exec-ing into containers) — these remain two entirely independent authorization surfaces regardless of mesh adoption, and a compromised workload with weak RBAC can still read every Secret in its namespace or `exec` into a sibling Pod via the Kubernetes API directly, a path AuthorizationPolicy has no visibility into at all since it only governs mesh-proxied application traffic, not Kubernetes-API calls; adopting a mesh adds a *third* independent layer to review, it does not substitute for or reduce the rigor required of the first two (RBAC and cloud IAM, §2.3/§2.4).

8. **Q: Design the complete, layered mitigation for the `pods/exec`-as-credential-access-path risk (Expert Q1), synthesizing this module's RBAC, PSA, and Secrets findings into a single defense-in-depth posture.**
 **A:** (1) Tightly RBAC-scope `pods/exec` and `pods/portforward` to only the specific identities with a genuine operational need (break-glass, on-call debugging), never granted broadly alongside general Pod-read access (Expert Q1/Q6). (2) Prefer the External Secrets Operator pattern (§2.2/§9.2) over native Kubernetes Secrets specifically because a credential fetched at Pod-mount time from a cloud secrets manager can be centrally rotated and access-audited *at the secrets manager itself*, giving the security team visibility into credential access independent of whether it occurred via `exec` or a legitimate application read. (3) Where genuinely sensitive Pods require `exec` access for legitimate debugging, require session recording/audit-logging of `exec` sessions specifically (a cluster-level audit policy capturing `pods/exec` requests in full, not merely as a generic API-call log line) so that even legitimate, RBAC-authorized `exec` access into a credential-bearing Pod leaves an auditable trail. (4) Disable `automountServiceAccountToken` (Expert Q5) for any workload with no Kubernetes-API-calling need, reducing what's even available to read via a compromised `exec` session in the first place.

9. **Q: A multi-tenant platform's namespace-provisioning template (§9.4) is discovered, eighteen months after initial rollout, to have never been updated when the platform's PSA baseline was later tightened from `baseline` to `restricted`. Diagnose the structural failure and design the fix.**
 **A:** This is a direct, second-order instance of this domain's "object presence ≠ enforced reality" pattern applied to *governance tooling itself*: the template's initial correctness was verified once, at rollout, but nothing re-verified that every namespace provisioned via it continued to reflect the *current*, evolving governance baseline as that baseline was tightened over time — the structural fix is treating the namespace-provisioning template the same way this module treats every other governance control: version it, and run a recurring, automated drift-detection check comparing every existing tenant namespace's actual PSA label/RoleBinding/NetworkPolicy configuration against the *current* template version, flagging (and remediating) any namespace still reflecting an older, superseded baseline — never assuming a template correct at authorship time remains correct indefinitely without re-verification.

10. **Q: As a Principal Engineer, design the complete configuration/security governance program (synthesizing §7-§9, the Advanced tier, and this Expert tier) required before a shared, multi-tenant cluster can be certified ready for a new PCI-scope tenant workload.**
 **A:** (1) Verified (not assumed) etcd encryption at rest, plus a migration path off native Secrets toward ESO with tenant-appropriate isolation scoping chosen deliberately (Expert Q4), not defaulted to the simplest, broadest-blast-radius option. (2) Independent, periodic RBAC audits covering not just standard resource/verb grants but wildcard-expansion-aware analysis (Expert Q2) and `pods/exec`/`pods/portforward` scoping specifically (Expert Q1/Q6/Q8), since these are the specific gaps PSA's own admission-time model structurally cannot see. (3) `restricted`/`enforce` PSA as the tenant default, explicitly understood as covering Pod-spec admission only — with the `exec`-as-bypass risk mitigated by a separate, dedicated control (Expert Q8), not assumed already covered by PSA compliance. (4) Admission-webhook infrastructure treated as Tier-0, capacity-planned against actual peak object-churn (§9.3), with `failurePolicy` behavior deliberately tested under simulated overload (Expert Q3), not merely configured and trusted. (5) A versioned, drift-detected namespace-provisioning template (§9.4/Expert Q9) ensuring every tenant namespace continuously reflects the platform's *current* governance baseline, not merely its baseline at initial onboarding. (6) `automountServiceAccountToken: false` as the default for any workload without a demonstrated Kubernetes-API-calling need (Expert Q5). This is the same audit-ready, structurally-enforced (not individually-trusted) governance posture this course has established as its standing capstone pattern, now fully specified for this module's own domain.

---

## 11. Coding Exercises

### Easy — A least-privilege Role/RoleBinding, explicitly namespace-scoped rather than cluster-wide (§Advanced Q9)
```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
 name: secret-reader
 namespace: checkout
rules:
 - apiGroups: [""]
 resources: ["secrets"]
 verbs: ["get", "list"] # read-only -- NOT create/update/delete (the least-privilege discipline)
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
 name: checkout-api-secret-reader
 namespace: checkout # scoped to THIS namespace only -- not a ClusterRoleBinding (§Advanced Q9)
subjects:
 - kind: ServiceAccount
 name: checkout-api
 namespace: checkout
roleRef:
 kind: Role
 name: secret-reader
 apiGroup: rbac.authorization.k8s.io
```

### Medium — Verifying etcd encryption at rest is actually active, not just configured (§Advanced Q5)
```bash
# Configuration existing is NOT sufficient evidence, per this module's recurring theme --
# explicitly verify a Secret's data is genuinely unreadable directly from etcd.

# Step 1 -- confirm the EncryptionConfiguration resource is referenced by the API server
kubectl get pods -n kube-system kube-apiserver-<node> -o yaml | grep encryption-provider-config

# Step 2 -- the definitive test: read the raw etcd value directly and confirm it is
# NOT plaintext-recoverable (requires etcd access -- typically only possible/tested
# during initial cluster hardening validation, not routinely, but establishes the
# actual verification standard):
ETCDCTL_API=3 etcdctl get /registry/secrets/checkout/db-credentials | hexdump -C | head
# Expected: encrypted, opaque bytes (e.g., prefixed with "k8s:enc:aescbc:") --
# NOT a recognizable base64 string trivially decodable back to plaintext.
```

### Hard — A Kyverno ClusterPolicy enforcing image-registry allow-listing (§Advanced Q4, extending PSA's coverage gap)
```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
 name: restrict-image-registries
spec:
 validationFailureAction: Enforce # NOT "Audit" -- explicitly verified, per this module's
 # recurring enforcement-mode lesson
 rules:
 - name: approved-registries-only
 match:
 resources:
 kinds: [Pod]
 validate:
 message: "Images must be pulled from the approved internal registry only."
 pattern:
 spec:
 containers:
 - image: "registry.internal.example.com/*" # rejects any other registry --
 # a gap PSA's built-in levels
 # don't cover at all (§Advanced Q4)
```

### Expert — Automated staged-rollout completion tracker, preventing the "abandoned migration" (§Advanced Q1, §Advanced Q3)
```csharp
public class StagedRolloutComplianceChecker
{
    // Directly the structural fix for the incident -- a rollout with only audit/warn
    // configured past its OWN declared target date is flagged, not silently trusted.
    public IEnumerable<string> CheckStalledRollouts(IEnumerable<NamespacePolicyStatus> namespaces)
    {
        foreach (var ns in namespaces)
        {
            if (ns.EnforcementMode is "audit" or "warn"
                && ns.DeclaredEnforceByDate.HasValue
                && ns.DeclaredEnforceByDate.Value < DateTime.UtcNow)
            {
                yield return $"Namespace '{ns.Name}': PSA rollout STALLED -- " +
                    $"still in '{ns.EnforcementMode}' mode, " +
                    $"{(DateTime.UtcNow - ns.DeclaredEnforceByDate.Value).Days} days past its " +
                    $"declared enforce-by date ({ns.DeclaredEnforceByDate.Value:yyyy-MM-dd}). " +
                    $"Owning team: {ns.OwningTeam} (this module/§Advanced Q1).";
            }
        }
    }

    // Advanced Q3's synthetic negative test -- the definitive verification, independent
    // of what the labels merely claim.
    public async Task<bool> VerifyActualEnforcementAsync(string @namespace, IKubernetesClient client)
    {
        var privilegedTestPod = BuildDeliberatelyNonCompliantPod(@namespace);
        try
        {
            await client.CreatePodAsync(privilegedTestPod);
            await client.DeletePodAsync(privilegedTestPod.Name, @namespace); // cleanup if it succeeded
            return false; // creation SUCCEEDED -- enforcement is NOT actually active, despite labels
        }
        catch (KubernetesAdmissionDeniedException)
        {
            return true; // creation was correctly REJECTED -- enforcement genuinely confirmed active
        }
    }
}
```

---

## 12. System Design

**Prompt:** Design the configuration and security architecture for a shared, multi-tenant Kubernetes platform hosting a card-payments processing tenant (PCI-DSS scope) alongside several lower-sensitivity internal tooling tenants, all on the same cluster.

**Requirements:**
- *Functional:* the payments tenant's Secrets (database credentials, payment-processor API keys) must never be readable by any other tenant's identity; every tenant namespace must enforce a documented Pod Security baseline; audit evidence must be producible on demand showing RBAC, PSA, and Secret-handling controls are actually enforced, not merely declared.
- *Non-functional:* onboarding a new tenant must not require re-deriving governance controls from scratch (§9.4's templating); admission-webhook enforcement must not become a cluster-wide availability risk (§9.3); the platform must tolerate the payments tenant's controls tightening over time without requiring a full-platform migration.

**Architecture:** Namespace-per-tenant isolation, each namespace provisioned exclusively via a versioned, GitOps-managed namespace template (§9.4) bundling: a tenant-appropriate PSA label (`restricted`/`enforce` mandatory for the payments tenant, `baseline`/`enforce` as the lower-sensitivity tenants' floor), a default-deny NetworkPolicy plus explicit allow-rules, a least-privilege Role/RoleBinding set scoped to that namespace only (never a ClusterRoleBinding for tenant-level access), and `automountServiceAccountToken: false` as the namespace-level default, opted back in per-workload only where genuinely needed. The payments tenant additionally uses a dedicated, tenant-scoped External Secrets Operator `SecretStore` (§9.2) backed by its own IAM-scoped access to the cloud secrets manager, isolated from the shared, lower-sensitivity tenants' own ESO configuration.

**Components:** A namespace-provisioning Operator (or GitOps repo structure) as the single source of truth for every tenant namespace's baseline (§13 details this as a controller); Kyverno/OPA Gatekeeper for custom policy enforcement beyond PSA's fixed levels (image-registry allow-listing, mandatory `automountServiceAccountToken: false` unless explicitly overridden with a documented justification annotation); per-tenant ESO `SecretStore` resources; a centralized RBAC-audit job (§Advanced Q8's `rbac-lookup`-style tooling) running on a recurring schedule against every namespace.

**Database selection:** Not directly this module's territory, but the payments tenant's own database credentials are exactly the kind of Secret this design's ESO isolation (not native Kubernetes Secrets) is built to protect — the credential's system of record lives in the cloud secrets manager, never duplicated into this cluster's etcd as the sole copy.

**Caching:** No caching layer sits between a Pod and its mounted Secret — Secret values are read fresh from the mounted tmpfs path on each application read, and any application-level in-memory caching of a fetched credential must respect the credential's own rotation cadence (a cached, un-refreshed credential surviving past its backing rotation is a correctness bug, not a performance optimization).

**Messaging:** Not directly applicable to this design's core scope; any message-broker credentials (Kafka SASL credentials, for instance) follow the identical ESO-backed pattern as database credentials, with no separate carve-out.

**Scaling:** RBAC review and namespace-provisioning consistency scale via automation (§9.1/§9.4), not manual per-tenant review; admission-webhook infrastructure is horizontally scaled and capacity-planned against peak platform-wide object-churn (§9.3), re-evaluated as tenant count grows, not sized once at initial rollout.

**Failure handling:** A degraded or unavailable Gatekeeper/Kyverno deployment under `failurePolicy: Fail` blocks new object creation platform-wide (§9.3) — mitigated via horizontal scaling, dedicated alerting on webhook health *before* it manifests as widespread failures, and an explicitly pre-approved, documented emergency `failurePolicy: Ignore` toggle procedure for a genuine, time-boxed incident-response exception (never a silent, permanent fallback).

**Monitoring:** RBAC-audit findings (wildcard grants, `pods/exec` scope, unused-permission detection) surfaced on a recurring dashboard, not only at initial tenant onboarding; PSA enforcement-mode drift alerts (any namespace found in `audit`/`warn` past its declared deadline, §Advanced Q1's pattern); namespace-template-version drift alerts (§Expert Q9) flagging any tenant namespace still reflecting a superseded governance baseline.

**Trade-offs:** Per-tenant ESO isolation (versus one shared, centrally-operated ESO instance) trades operational simplicity for blast-radius containment (§9.2/§Expert Q4) — explicitly justified here by the payments tenant's PCI scope, even though it means the platform team operates more, smaller pieces of secrets-management infrastructure rather than one larger, simpler one.

## 13. Low-Level Design

**Prompt:** Design the internal reconciliation logic of a namespace-provisioning Operator (§9.4/§12) that watches a `TenantNamespace` custom resource and ensures the resulting namespace's PSA label, default RoleBindings, NetworkPolicy, and ESO `SecretStore` stay continuously reconciled to the template's *current* version — directly implementing the fix for §Expert Q9's template-drift incident.

**Requirements:** Reconcile continuously (an ongoing control loop, not a one-shot provisioning script) so that any manual, out-of-band drift (someone hand-editing a tenant namespace's PSA label) is detected and corrected; support versioned templates so a platform-wide baseline tightening (e.g., `baseline` → `restricted`) can be rolled out with an explicit, tracked per-tenant migration state rather than a silent, uniform force-push; be extensible to new governed resource types without restructuring the core loop; be safe under concurrent reconciliation of many tenant namespaces simultaneously.

**Class diagram:**
```mermaid
classDiagram
 class TenantNamespaceReconciler {
 -IEnumerable~IGovernedResourceSync~ syncers
 -ITemplateVersionStore templateStore
 +ReconcileAsync(TenantNamespace tenant) ReconcileResult
 }
 class IGovernedResourceSync {
 <<interface>>
 +Sync(TenantNamespace tenant, TemplateVersion version) SyncResult
 }
 class PsaLabelSync { +Sync }
 class RoleBindingSync { +Sync }
 class NetworkPolicySync { +Sync }
 class SecretStoreSync { +Sync }
 class ReconcileResult { +bool Drifted +List~SyncResult~ Applied }

 TenantNamespaceReconciler o-- IGovernedResourceSync
 IGovernedResourceSync <|.. PsaLabelSync
 IGovernedResourceSync <|.. RoleBindingSync
 IGovernedResourceSync <|.. NetworkPolicySync
 IGovernedResourceSync <|.. SecretStoreSync
 TenantNamespaceReconciler --> ReconcileResult
```

**Sequence diagram:**
```mermaid
sequenceDiagram
 participant Watch as TenantNamespace Informer
 participant Recon as TenantNamespaceReconciler
 participant Store as ITemplateVersionStore
 participant Syncers as IGovernedResourceSync[]
 participant K8s as Kubernetes API

 Watch->>Recon: TenantNamespace added/updated/resync tick
 Recon->>Store: GetCurrentTemplateVersion(tenant.Tier)
 Store-->>Recon: TemplateVersion (e.g., "restricted-v3")
 loop each registered syncer
 Recon->>Syncers: Sync(tenant, version)
 Syncers->>K8s: Get actual resource state
 alt actual state differs from template
 Syncers->>K8s: Patch to match template
 Syncers-->>Recon: SyncResult (Drifted: true, Corrected: true)
 else already matches
 Syncers-->>Recon: SyncResult (Drifted: false)
 end
 end
 Recon->>Recon: Aggregate into ReconcileResult, emit drift metric if any syncer corrected drift
```

**Design patterns used:** **Strategy** (each `IGovernedResourceSync` is an independently-testable, swappable governed-resource rule, the same pattern §13 of Module 75 applied to storage governance checks); **Observer/reconciliation-loop** (the Operator pattern generally — react to the watch stream and continuously converge actual state toward desired state, rather than a one-shot imperative script); **Template Method**-flavored version resolution (`GetCurrentTemplateVersion` centralizes "what does correct look like right now" so every syncer references the same, single current version rather than each independently hardcoding it).

**SOLID mapping:** Single Responsibility (each syncer reconciles exactly one governed resource type); Open/Closed (a new governed resource — e.g., a future `pods/exec` RBAC-scoping syncer per §Expert Q8 — is added as a new `IGovernedResourceSync` implementation without modifying the reconciler); Liskov Substitution (every syncer is interchangeable within the reconciler's syncer list); Interface Segregation (`IGovernedResourceSync`'s single-method contract keeps each syncer focused); Dependency Inversion (the reconciler depends on the `IGovernedResourceSync` and `ITemplateVersionStore` abstractions, not concrete resource-patching logic or a concrete version-storage mechanism).

**Extensibility:** Tightening the platform's PSA baseline from `baseline` to `restricted` is a new `TemplateVersion` published to the `ITemplateVersionStore` — every tenant namespace's next reconciliation cycle picks up the new target automatically (with an explicit, tracked per-tenant rollout schedule if a gradual migration is required, mirroring the PERMISSIVE-to-STRICT tracked-deadline pattern this domain establishes elsewhere), with no change to the reconciler's own code.

**Concurrency / thread safety:** Each `TenantNamespace`'s reconciliation is independent of every other tenant's — safe to run concurrently across many tenants by construction, since no shared mutable state exists between them; reconciliation of the *same* tenant triggered by rapid successive events should be debounced/requeued (the standard Operator-pattern discipline, matching §13 of Module 75) to avoid redundant, overlapping patches racing against each other for a single tenant's resources.

## 14. Production Debugging

**Incident:** A trading platform's on-call engineer, investigating unrelated slow order-execution latency, discovers via routine log review that a low-privilege internal reporting-tool ServiceAccount in a shared "analytics" namespace has, for the past several weeks, been successfully reading Secrets from the "trading-execution" namespace — a namespace that should have been entirely inaccessible to it.

**Root cause:** Months earlier, a platform engineer had created a `ClusterRole` named `read-only-reporting` (a name suggesting narrow, safe scope) intended to let the analytics tool read ConfigMaps cluster-wide for a dashboard feature — but the `rules` block was authored with `apiGroups: [""]`, `resources: ["*"]`, `verbs: ["get", "list"]`, rather than the intended `resources: ["configmaps"]` specifically — a single, easy-to-miss wildcard character. Because it was bound via a `ClusterRoleBinding` (not a namespace-scoped `RoleBinding`, since the original requirement genuinely was cluster-wide *ConfigMap* access), the wildcard silently extended `get`/`list` access to *every* core-API-group resource cluster-wide, including Secrets in every namespace — exactly §8.2's wildcard-permission risk, undetected for months because the RBAC object's *name* looked correctly scoped and no automated review had ever inspected the literal `rules` block against actual, effective resource coverage.

**Investigation:** (1) Confirmed via the Kubernetes audit log that the `analytics-reporting` ServiceAccount had indeed issued `get secrets` requests against the `trading-execution` namespace, ruling out a credential-theft/impersonation scenario and confirming this was RBAC's own, legitimately-granted (if unintended) permission being exercised. (2) `kubectl describe clusterrole read-only-reporting` revealed the wildcarded `resources: ["*"]` rule directly. (3) Cross-referenced `kubectl get clusterrolebinding -o wide` to confirm the binding's cluster-wide (not namespace-scoped) subject reach, explaining why the namespace boundary the team had assumed was protective provided no actual containment at all.

**Tools:** Kubernetes audit logs (the definitive evidence of *actual* API usage, not merely granted permission) as the starting signal; `kubectl describe clusterrole`/`kubectl get clusterrolebinding -o yaml` for the definitive permission-grant inspection; an ad hoc `rbac-lookup`-style effective-permission enumeration run retroactively across the whole cluster once the pattern was suspected, to check for any *other* similarly wildcarded Roles.

**Fix:** Corrected the `ClusterRole`'s `resources` field to the intended `["configmaps"]`, immediately eliminating the unintended Secret-read access; rotated every Secret in the `trading-execution` namespace as a precaution (treating the multi-week unintended-access window as a genuine, if unconfirmed, exposure event, not merely a configuration bug to quietly fix); and reviewed audit logs for any evidence the access had actually been exercised maliciously (none found, but the review itself was the necessary due diligence, not an optional step).

**Prevention:** Implemented the automated RBAC-audit tooling (§Advanced Q8/§9.1) as a standing, recurring cluster-wide scan — specifically configured to flag any Role/ClusterRole whose `rules` include a wildcarded `resources` or `apiGroups` field for mandatory human review before merge (a pre-merge admission check in the GitOps pipeline, not merely a post-hoc periodic audit), directly closing the exact gap (a wildcard's presence going unreviewed because the object's name looked narrowly scoped) that let this incident persist undetected for weeks.

## 15. Architecture Decision

**Decision:** For managing Secrets across the multi-tenant platform's tenants, should the platform standardize on (A) native Kubernetes Secrets with etcd encryption at rest, (B) a single, centrally-operated External Secrets Operator instance with one broad, cross-tenant IAM role, or (C) per-tenant ESO instances/`SecretStore` scoping with tenant-isolated IAM roles?

| Option | Advantages | Disadvantages | Cost | Complexity | Maintainability | Scalability | Operational overhead |
|---|---|---|---|---|---|---|---|
| **(A) Native Secrets + etcd encryption** | Simplest to adopt; no external dependency; works identically for every tenant | No native rotation; no centralized access audit trail beyond Kubernetes audit logs; protection depends entirely on etcd encryption being correctly, verifiably configured (§2.2) | Lowest | Low | Low ongoing effort, but weakest security posture of the three | Scales trivially (no additional infrastructure), but security review burden scales with tenant count | Low, but the *audit/compliance* burden shifts elsewhere |
| **(B) Single, centrally-operated ESO, broad cross-tenant IAM role** | Centralized rotation/audit via the cloud secrets manager; simpler to operate than per-tenant instances | A single compromise's blast radius spans every tenant's secrets (§Expert Q4) — the highest-severity single point of failure of the three options | Medium | Medium | Easier for the platform team to operate day-to-day | Scales well operationally, poorly from an isolation standpoint | Medium — one component, but a high-value target requiring proportionally elevated hardening |
| **(C) Per-tenant ESO/`SecretStore`, tenant-isolated IAM** | Blast radius contained to one tenant per compromise; each tenant's secrets-access audit trail is independently attributable | More moving parts to provision and keep consistent per-tenant (mitigated by §9.4's namespace-templating Operator); higher initial setup cost per tenant | Medium-High | High | Requires the templating/Operator discipline (§13) to avoid per-tenant drift becoming its own maintenance burden | Scales well with tenant count specifically because isolation is structural, not review-dependent | Higher, but front-loaded into the templating Operator rather than ongoing per-incident risk |

**Recommendation:** **(C) for the PCI-scope payments tenant specifically; (B) as the platform-wide default for lower-sensitivity tenants**, with the namespace-provisioning Operator (§13) making per-tenant ESO scoping a templated, low-marginal-cost default for any tenant whose data classification warrants it, rather than a bespoke, one-off engineering effort each time — directly the same "match the isolation architecture to the actual sensitivity, and make the stronger option cheap enough to adopt broadly via templating" reasoning this course applies throughout; (A) alone is explicitly rejected for any genuinely sensitive tenant, since it provides neither the rotation nor the centralized audit trail a PCI-adjacent compliance posture requires, regardless of how correctly etcd encryption is configured.

## 17. Principal Engineer Perspective

**Business impact:** This module's findings protect against business outcomes ranging from a compliance-audit failure (§2.2's encryption gap) to a genuine credential-exfiltration incident (§14's wildcard RBAC finding) — a Principal Engineer frames RBAC and Secret-handling discipline not as abstract security hygiene but as direct, quantifiable protection against specific, costly failure modes: a multi-week unintended cross-tenant Secret-read window, discovered by accident rather than by design, is exactly the kind of latent risk that becomes a regulatory or customer-trust incident the moment it's exploited rather than merely discovered.

**Engineering trade-offs:** Every architecture decision in this module trades operational simplicity against isolation/audit strength: native Secrets vs. ESO (§15); a single centrally-operated ESO vs. per-tenant isolation (§Expert Q4/§15); `failurePolicy: Fail` vs. `Ignore` for admission webhooks (§9.3) — a Principal Engineer's job is making each trade-off explicit and matched to the actual sensitivity of the data or workload involved, not applying one uniform default cluster-wide regardless of tenant risk profile.

**Technical leadership:** The durable fix for §14's incident isn't manually re-reviewing every existing Role — it's building the automated, wildcard-aware RBAC-audit tooling (§Advanced Q8) and wiring it into the GitOps pipeline as a pre-merge gate, the same "build the structural system, don't rely on individual vigilance" leadership pattern this course establishes throughout.

**Cross-team communication:** A tenant team's own RBAC requests ("we need to read ConfigMaps cluster-wide") must be translated by the platform team into the *narrowest* Role/RoleBinding that satisfies the actual stated need — §14's incident originated from exactly this translation step going wrong; a Principal Engineer treats every RBAC-grant request as requiring this translation discipline explicitly, not as a rubber-stamp approval of whatever scope a requesting team's ticket happened to describe.

**Architecture governance:** The namespace-provisioning Operator (§13) is this module's concrete instance of "governance as structurally enforced infrastructure, not a checklist" — a Principal Engineer designing platform governance anticipates that any control relying on a human correctly repeating a manual process at every tenant onboarding will eventually drift or be skipped, and builds the automation that makes correctness the path of least resistance instead.

**Cost optimization:** Per-tenant ESO isolation (§15, Option C) costs more to operate per-tenant than a single shared instance — a Principal Engineer justifies that incremental cost specifically for tenants whose data sensitivity warrants it, and avoids over-applying the more expensive, more isolated pattern to every tenant uniformly where a shared instance's lower cost and adequate isolation genuinely suffice.

**Risk analysis:** §14's incident is a useful proportionality case study: the actual finding (a wildcarded ClusterRole) was low-effort to fix once found, but the multi-week undetected exposure window is the real risk this module's tooling recommendations (Advanced Q8, §9.1) exist to close — a Principal Engineer's risk analysis distinguishes "how hard is this to fix" from "how long would this have gone undetected without structural, automated review," and invests in closing the detection gap, not merely fixing the one instance found.

**Long-term maintainability:** A governance posture that depends on every engineer authoring RBAC correctly by hand, forever, accumulates the same silent, compounding risk this domain's other capstone findings describe — the durable answer, repeated once more in this module's own specific terms, is automated, continuously-verified enforcement (RBAC-audit tooling, namespace templating, admission-webhook policy) over individually-trusted manual discipline.

---

## 18. Revision
**Key takeaways**: Kubernetes configuration and security rest on distinguishing several pairs of concepts that look similar but are structurally independent: ConfigMaps (non-sensitive) vs. Secrets (sensitive, but only base64-encoded by default — genuine protection requires separately-configured etcd encryption at rest); Kubernetes RBAC (governs the Kubernetes API) vs. cloud IAM (governs cloud resources) — two entirely independent authorization systems a ServiceAccount straddles simultaneously via RBAC bindings and IRSA/Workload-Identity federation, both requiring independent least-privilege review. This module's central finding directly confirms a prediction seeded §Advanced Q7: Pod Security Admission's enforcement mode (enforce/audit/warn) is a structural recurrence of NetworkPolicy's CNI-dependent enforcement gap and the reclaim-policy gap — a namespace's PSA labels being present and syntactically valid provides zero evidence of actual blocking enforcement, and the incident demonstrates the specific, realistic failure mode: an inherently sound, staged audit-then-enforce rollout silently stalling indefinitely once its phase-two completion loses individual ownership, with no structural forcing function to complete it. This is now the third instance across Modules 74–76 of this domain's unifying lesson: a Kubernetes control-plane object's declared presence is decoupled, by design, from the actual behavior of the pluggable downstream component (a CNI plugin, a CSI driver, an admission controller) responsible for genuinely enforcing it — every such control requires explicit, ongoing, automated verification of real runtime behavior, never trust in object presence alone.

---

**Next**: Module 77 — Kubernetes: Scheduling & Autoscaling — Scheduler Internals, Affinity/Taints/Tolerations & HPA/VPA/Cluster Autoscaler, continuing the `23-Kubernetes` domain (Modules 73–80).
