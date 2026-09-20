# Kubernetes — Cram Sheet

> Tier 2 · Source: `23-Kubernetes/` (8 modules, 3,803 lines) · Read: 15 min

---

## The recurring theme of this whole domain

> **Object presence ≠ enforced reality.** A resource applying successfully proves *nothing* about whether anything acted on it. A NetworkPolicy that applies may not be enforced (the CNI may not support it). A CRD that registers does nothing without a controller. An Ingress with an empty `ADDRESS` means the controller never provisioned anything. **Always verify the effect, not the object.** Say this and you sound like you've operated a cluster.

---

## 1. Architecture

- **Control plane:** **API server** (the only thing that talks to etcd) · **etcd** (the *only* source of truth) · scheduler · controller-manager · cloud-controller-manager.
- **Node:** **kubelet** (owns pod lifecycle on the node) · **kube-proxy** (implements Service routing via iptables/IPVS) · container runtime (containerd).
- **The reconciliation loop is the one pattern generalising nearly everything:** observe actual state → compare to declared state → act to converge. Controllers, operators, HPA, and the scheduler are all instances of it.
- **Pod = the atomic deployable unit**, not the container. Containers in a pod share network namespace (same localhost/IP) and can share volumes. Sidecars live here.
- **Deployment → ReplicaSet → Pod.** You almost never create a ReplicaSet directly — the Deployment manages rollout/rollback by creating a new ReplicaSet and scaling the old one down.
- **Managed control planes (EKS/AKS/GKE)** run the API server and etcd for you; **you still own nodes, add-ons, upgrades, and everything you deploy.**

---

## 2. Workload objects

| Object | For |
|---|---|
| **Deployment** | stateless replicas, rolling update/rollback |
| **StatefulSet** | **stable identity** (`pod-0`, `pod-1`) + **stable per-replica storage** + ordered start/stop |
| **DaemonSet** | one pod per node (log shippers, CNI, node agents) |
| **Job / CronJob** | run to completion / on a schedule |

---

## 3. Networking

- **Service** solves the ephemeral-pod-IP problem by giving a stable virtual IP + DNS name.
  - **ClusterIP** (internal) · **NodePort** (a port on every node) · **LoadBalancer** (provisions a cloud LB) · **ExternalName** (a DNS CNAME) · **Headless** (`clusterIP: None`, returns pod IPs — used by StatefulSets).
- **EndpointSlices** are the continuously reconciled list of pod IPs a Service routes to. **A pod only appears once its readiness probe passes** — the standard "Service returns nothing" debug is `Running` but `0/1 READY`.
- **CNI** implements the required flat network model (every pod gets a routable IP, no NAT between pods). Calico, Cilium, AWS VPC CNI.
- **Ingress is a spec; the controller does the work.** No controller ⇒ nothing happens. An empty `ADDRESS` field after minutes means the controller isn't running or is erroring — check **the controller's** logs, not the app's.
- **CoreDNS naming:** `<service>.<namespace>.svc.cluster.local`.
- **NetworkPolicy is default-allow-all until at least one policy selects a pod** — and **requires CNI support**, which is the easy-to-miss prerequisite: applying a policy on a CNI that ignores them succeeds silently and enforces nothing. **Verify both directions** — the authorised path still works *and* the unauthorised path is actually blocked.

---

## 4. Storage

- **`emptyDir` is pod-lifetime-scoped, not pod-restart-scoped** — it survives a container restart but dies with the pod.
- **PV / PVC** decouple storage supply from demand. **StorageClass** enables dynamic provisioning (this is what actually creates the EBS volume / Azure disk).
- **Access modes — the one that bites:** **RWO** (ReadWriteOnce) = one **node** at a time. A second pod on a different node gets `Multi-Attach error` and never schedules. Shared access needs **RWX**, which needs an RWX-capable backend (EFS/Azure Files) — EBS cannot do it.
- **Reclaim policy defaults to `Delete`** on dynamically provisioned volumes → **deleting the PVC destroys the data.** For anything critical, explicitly set `Retain`.
- **StatefulSet** gives each replica a stable name and its **own** PVC (`data-web-0`, `data-web-1`) — a Deployment gives neither.

---

## 5. Configuration & Security

- **ConfigMap** for non-sensitive config. Mounted as a volume it **updates in place** (eventually); as an env var it does **not** — you must restart the pod.
- **A Secret is base64, not encryption.** Anyone with API read access or etcd access sees it. **Encryption at rest for etcd is a separate configuration that is often missing.** Better: external secret stores (Secrets Manager/Key Vault) via the CSI driver or External Secrets Operator.
- **RBAC governs the Kubernetes API — a genuinely separate system from cloud IAM.** `Role`/`RoleBinding` (namespaced) vs `ClusterRole`/`ClusterRoleBinding`. Verbs: get/list/watch/create/update/patch/delete.
- **ServiceAccount** is the identity a pod presents to the API server, and the thing that federates to cloud IAM (**IRSA** on EKS, Workload Identity on GKE/AKS).
- **Pod Security Admission** replaced PodSecurityPolicy. Three levels — **privileged / baseline / restricted** — and three modes: **`enforce` / `audit` / `warn`. A namespace labelled `audit` only logs; it blocks nothing.** That enforcement-mode gap is the recurring trap.
- **Admission controllers** are the general mechanism: **mutating** (inject sidecars, defaults) then **validating** (reject). OPA Gatekeeper / Kyverno for policy-as-code.
- Hardening: `runAsNonRoot`, drop all capabilities, read-only root filesystem, no `hostNetwork`/`hostPID`, resource limits set, image from a trusted registry with a digest.

---

## 6. Scheduling & Autoscaling

- **Scheduler is two phases: filter** (which nodes *can* run this — resources, taints, affinity, volume topology) **then score** (which is *best*). `Pending` means filtering eliminated every node — **read the scheduler's events, not `kubectl logs`**, e.g. `0/12 nodes are available: 12 Insufficient memory`.
- **Requests vs limits:** *requests* drive scheduling and the QoS class; *limits* cap runtime. **CPU limits throttle; memory limits OOM-kill.** QoS: Guaranteed (requests = limits) > Burstable > BestEffort (killed first).
- **Affinity/anti-affinity = pull**; **taints/tolerations = push/repel** (dedicating nodes, e.g. Spot or GPU). **Pod anti-affinity across zones is required, not optional, for real HA** — otherwise all replicas can land on one node.
- **PodDisruptionBudget** protects availability during *voluntary* disruptions (drains, upgrades).
- **Three autoscalers, three dimensions:**
  - **HPA** — replica count from metrics.
  - **VPA** — right-sizes requests/limits. **Do not combine VPA and HPA on the same CPU/memory metric** — they fight.
  - **Cluster Autoscaler / Karpenter** — adds *nodes*.
- **The full autoscaling chain is three sequential delays, not one fast reaction:** metric scrape → HPA decision + stabilisation → pod scheduling → (if no capacity) node provisioning + image pull. That total can be minutes — which is exactly why **load shedding must come before autoscaling**.

---

## 7. Helm · Operators · CRDs

- **Helm is a templating and release tool, and it is one-shot, not continuous.** It renders and applies; it does **not** reconcile afterwards. Manual `kubectl edit` drift persists until the next `helm upgrade` silently reverts it — so **commit the fix to `values.yaml`**, not to the live object.
- **Operator = CRD + custom controller**, encoding operational expertise as a *continuous* reconciliation loop (backups, failover, version upgrades). This is the difference from Helm: continuous vs one-shot.
- **A CRD alone does nothing.** Applying it registers the schema; objects of that kind will be accepted and stored, and **nothing will act on them until a controller is deployed watching them.**
- **Helm and operators are complementary** — commonly Helm installs the operator.
- **CRD versioning needs the same discipline as event schemas** — conversion webhooks, additive changes, a deprecation path.

---

## 8. Service Mesh

- **Sidecar injection** via a **mutating admission webhook**.
- **mTLS mesh-wide** — but **`PERMISSIVE` mode accepts both plaintext and mTLS**, which is how a "we have mTLS everywhere" claim silently isn't true. Move to `STRICT` and verify.
- **Declarative traffic management** — `VirtualService`/`DestinationRule` push retries, timeouts, circuit breaking and canary weights into the infrastructure.
- **Istio** (most features, most complexity) vs **Linkerd** (simple, fast, Rust proxy) vs **Cilium** (eBPF, no sidecar) vs **Ambient mesh** (removes the per-pod sidecar). **Choose by "do we need per-request L7 policy across many languages" — if not, a library may be cheaper.**

---

## 9. Observability & GitOps

- **Prometheus (pull-based) + Grafana**; the Prometheus Operator is the production pattern. **OpenTelemetry** unifies metrics, logs and traces vendor-neutrally.
- **GitOps (Argo CD / Flux):** Git is the declared state, a controller continuously reconciles the cluster to it. **This is the structural fix for drift** — and for the Helm one-shot problem.
- **GitOps solves drift; it does not solve a wrong declaration — and it can amplify false confidence in one.** Good line to deliver.
- **Multi-cluster is often correct**, not a failure: blast radius, regulatory isolation, version-upgrade staging, per-region residency.

---

## Debugging playbook

| Symptom | Look at |
|---|---|
| `Pending` | **scheduler events** — insufficient resources, taints, volume topology, node selector |
| `CrashLoopBackOff` | `kubectl logs --previous`, exit code, failing liveness probe, missing config |
| `ImagePullBackOff` | registry auth, image tag/digest, network egress |
| `Running` but `0/1 READY` | readiness probe failing → pod is **not** in the EndpointSlice → Service returns nothing |
| `OOMKilled` (137) | memory limit too low, or a real leak |
| Service returns nothing | EndpointSlice empty → readiness; then selector/label mismatch |
| Ingress `ADDRESS` empty | the **Ingress controller**, not the app |
| Policy "applied" but not enforced | CNI doesn't support NetworkPolicy; PSA in `audit` mode |

---

## Top traps

1. Object applied ≠ enforced.
2. NetworkPolicy without CNI support.
3. Pod Security Admission in `audit` mode.
4. Secrets assumed encrypted.
5. RWO PVC expected to be shared across nodes.
6. Reclaim policy left as `Delete` on critical data.
7. VPA + HPA on the same metric.
8. Expecting autoscaling to absorb a sudden spike (three sequential delays).
9. Helm treated as continuous reconciliation.
10. CRD applied without a controller.

---

## Interview Q&A — Lead / Principal

### Q1 · The NetworkPolicy that enforced nothing *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"An audit found that pods in the PCI namespace were reachable from everywhere, despite a NetworkPolicy being applied months ago."*

**Answer.** The policy object existed; enforcement didn't. **NetworkPolicy is implemented by the CNI**, and if the CNI doesn't support it — or the feature isn't enabled — `kubectl apply` succeeds, the object persists, `kubectl get` shows it, and **nothing enforces it**. There's no error anywhere. This is the recurring lesson of this whole domain: **object presence is not enforced reality.**

So the fix is twofold. Immediately: confirm the CNI supports policies, and then **verify empirically in both directions** — a positive test that an authorised namespace can still reach the pod, and a **negative test that an unauthorised one is actually blocked**. The negative test is the one nobody writes, and it's the only one that would have caught this.

Structurally, I'd make that a continuous control rather than a one-off audit finding: a scheduled job that attempts the blocked connection from an unauthorised namespace and alarms if it succeeds. Same pattern applies to the other silent-enforcement gaps in Kubernetes — **Pod Security Admission running in `audit` mode logs and blocks nothing**, and a CRD applied without a controller accepts objects that nothing acts on. All three fail open and fail silently, which is why "we applied the manifest" is never evidence.

**Why it lands.** Names the CNI dependency, insists on negative testing, and generalises to the whole class of fail-open Kubernetes controls.
**✗ Weak answer.** "Re-apply the policy" or "check the YAML."
**↳ Follow-ups.** How would you test this continuously? What else in your cluster fails open?

---

### Q2 · Autoscaling didn't save us *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"Traffic tripled in 90 seconds. HPA was configured. We still dropped requests. Why?"*

**Answer.** Because autoscaling is **three sequential delays, not one reaction**: the metrics scrape interval, then the HPA's evaluation and stabilisation window, then pod scheduling — and if there's no spare node capacity, node provisioning plus image pull on top. That chain is minutes; the overload was 90 seconds. Autoscaling is a capacity-planning mechanism, not an overload-protection mechanism, and expecting it to absorb a spike is the mistake.

What actually protects you in that window is **load shedding ahead of autoscaling** — reject or degrade low-priority traffic immediately so the critical path survives — plus queueing with bounded depth, and headroom: running at a utilisation level that absorbs the first spike while the scaler catches up. If spikes are predictable (market open, a campaign), **pre-scale on a schedule**, which is unglamorous and works.

I'd also check the second-order failures, because they're common here: pods that scaled but weren't `Ready` because the readiness probe checks a dependency that was itself saturated; and cold caches on new pods hammering the database, which makes scaling out briefly make things *worse*. And I'd look at whether `Karpenter` versus Cluster Autoscaler changes the node-provisioning leg, since that's usually the longest one.

**Why it lands.** Names the three delays, distinguishes capacity planning from overload protection, and covers the second-order failures.
**✗ Weak answer.** "Tune the HPA thresholds."
**↳ Follow-ups.** What do you shed first? How much headroom is right?

---

### Q3 · Should we adopt Kubernetes? *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"We have eight .NET services on VMs. A team wants to move to EKS. Your call."*

**Answer.** Probably not yet, and I'd want the argument to be about the problem rather than the technology. Kubernetes solves scheduling across many nodes, self-healing, declarative rollout and multi-team autonomy at scale. With eight services and one team, you likely have none of those problems acutely, and you'd be taking on cluster upgrades, CNI and IP planning, RBAC, admission control, add-on lifecycle and a new class of failure the team hasn't debugged before. **The cost of EKS isn't the control-plane fee, it's the people.**

The intermediate options deserve a hearing: **ECS with Fargate** gives containers, rolling deploys and autoscaling with a fraction of the operational surface, and for an AWS-only .NET estate that's often the right landing point. App Runner or Container Apps if it's simpler still.

What would flip me to yes: a platform team that exists and wants to own it; genuine multi-team autonomy needs; a requirement for portability across clouds or on-prem; or an ecosystem dependency — operators, Helm charts, or a service mesh — we actually need. And if we do go, I'd want the golden path built first, because eight teams inventing their own manifests is how you get a cluster nobody can reason about.

**Why it lands.** Names what K8s actually solves, prices it in people, offers the intermediate option, and states what would change the answer.
**✗ Weak answer.** "Yes, it's the industry standard."
**↳ Follow-ups.** What would you need to see in 12 months to revisit? Who runs the upgrades?

---

### Quick-fire (30 seconds each)

- **"A pod is Pending — what do you do?"** → `kubectl describe pod` and read the **scheduler's events**, not the container logs — there is no container yet. Pending means the filter phase eliminated every node: insufficient CPU/memory against *requests*, an untolerated taint, a node selector or affinity rule nothing satisfies, or a volume topology constraint pinning it to a zone with no capacity. Then I check actual node capacity before assuming the fix is more nodes.
- **"Liveness vs readiness?"** → Liveness failing restarts the container, so it must only test whether the process is wedged — never a dependency, or one database blip restarts the fleet. Readiness failing removes the pod from the Service's EndpointSlice, so it *should* check dependencies. Getting them backwards is how a transient downstream outage becomes a cluster-wide restart storm.
- **"How does a pod get cloud permissions?"** → Workload identity federation — on EKS that's IRSA or Pod Identity: the cluster has an OIDC provider, the ServiceAccount is annotated with a role ARN, and the pod exchanges a projected token for short-lived credentials. The alternative people reach for is granting the node's instance role, which silently gives every pod on that node the same permissions — that's the finding I'd raise in a review.

---

**Go deeper:** `23-Kubernetes/01`–`08` · **Related:** [[24-Docker]], [[21-AWS]], [[38-APIGateway-ServiceMesh-IAM]], [[25-DevOps-CICD]]
