# 10. Kubernetes — 30 Questions (Answered)

> **Method:** every definition is quoted from the **official Kubernetes documentation** (kubernetes.io/docs) — Concepts, Tasks and Reference sections — supplemented by the **Amazon EKS User Guide** and the **EKS Best Practices Guides** where the question is AWS-specific, and by **Microsoft Learn** for the .NET container guidance. Then the architect-level trade-off, the failure mode and the production runbook. Links in **References**.

---

## Q1. What is Kubernetes?

**Per the Kubernetes documentation:** *"Kubernetes is a portable, extensible, open source platform for managing containerized workloads and services, that facilitates both declarative configuration and automation."*

**The single idea underneath everything:** Kubernetes is a **declarative, level-triggered control system**. You state desired state; controllers continuously observe actual state and act to converge the two. It is not a script runner and it is not edge-triggered — this is why `kubectl apply` is idempotent, why a deleted pod comes back, and why "it worked when I ran it" is not how you reason about a cluster.

**Control plane components:**

| Component | Role |
|---|---|
| **kube-apiserver** | The only component that talks to etcd; the front door for every read and write; where authn, authz (RBAC) and admission control happen |
| **etcd** | Consistent, highly available key-value store — the cluster's entire state. **Back it up.** |
| **kube-scheduler** | Assigns pods to nodes based on requests, constraints, affinity, taints |
| **kube-controller-manager** | The reconciliation loops — Deployment, ReplicaSet, Node, EndpointSlice, Job controllers |
| **cloud-controller-manager** | Cloud-specific loops — provisions load balancers, volumes, routes |

**Node components:** **kubelet** (the agent that makes pods on this node match spec, and runs probes), **kube-proxy** (implements Service networking via iptables/IPVS — increasingly replaced by eBPF dataplanes such as Cilium), and a **container runtime** (containerd or CRI-O; Docker Engine as a runtime was removed in v1.24).

**What Kubernetes gives you:** service discovery and load balancing, storage orchestration, automated rollouts and rollbacks, bin-packing, self-healing, and secret/config management.

**What it explicitly does not do — the documentation is unusually blunt, and quoting it well shows maturity:** Kubernetes *"does not limit the types of applications supported"*, *"does not deploy source code and does not build your application"*, *"does not provide application-level services, such as middleware, data-processing frameworks, databases, caches"* as built-in services, and *"does not dictate logging, monitoring, or alerting solutions"*. It is a platform for building platforms. Everything a production cluster actually needs — ingress, observability, secrets, policy, CI/CD, service mesh — is something you choose, install, and then own for the life of the cluster. That ownership cost is the honest counterweight to "we'll just use Kubernetes."

---

## Q2. What is a Pod?

**Per the documentation:** *"Pods are the smallest deployable units of computing that you can create and manage in Kubernetes."* More fully: *"A Pod is a group of one or more containers, with shared storage and network resources, and a specification for how to run the containers. A Pod's contents are always co-located and co-scheduled, and run in a shared context. A Pod models an application-specific 'logical host': it contains one or more application containers which are relatively tightly coupled."*

**What containers in a Pod share:**

| Shared | Consequence |
|---|---|
| **Network namespace** | One IP per Pod; containers reach each other on **`localhost`**; they must not collide on ports |
| **Storage volumes** | Mounted into any container in the Pod |
| **Lifecycle and scheduling** | Always co-located on one node, started and stopped as a unit |
| IPC namespace (optional), PID namespace (optional) | Shared memory / process visibility when enabled |

**Container roles within a Pod:**

- **App containers** — the workload.
- **Init containers** — run to completion, in order, before app containers start. Use for migrations, waiting on dependencies, fetching config.
- **Sidecars** — since v1.29, sidecars are modelled as **init containers with `restartPolicy: Always`**, which fixes the long-standing problem of sidecars outliving or dying before the main container. Log shippers, service-mesh proxies, secret agents.

**Pod lifecycle phases:** `Pending → Running → Succeeded | Failed`, with `Unknown` when the node is unreachable. **Pods are never healed — they are replaced.** A Pod is mortal and its IP is ephemeral; nothing should ever hold a Pod IP.

**The rule from the docs:** *"Usually you don't need to create Pods directly, even singleton Pods. Instead, create them using workload resources such as Deployment or Job."* A bare Pod has no controller, so if its node dies, it is simply gone.

---

## Q3. Why is Pod the smallest deployable unit?

Because some processes are **genuinely coupled** — they must run on the same machine, share a network identity and a filesystem, and live and die together — and Kubernetes needed one abstraction that expresses that without forcing you to bake several processes into a single image.

**The design reasoning, in the terms the documentation uses:**

1. **Co-location and co-scheduling are the primitive.** *"A Pod's contents are always co-located and co-scheduled."* Scheduling a *container* would leave "these two must be on the same node, sharing localhost" inexpressible.
2. **The Pod is the network identity.** One IP per Pod, not per container, is what makes the Kubernetes network model coherent: every Pod gets a routable IP and can reach every other Pod without NAT. If containers were the unit, you would be back to port-mapping.
3. **It preserves one-process-per-container.** Without Pods, adding a log shipper or a proxy means stuffing it into the application image with a supervisor. The Pod lets you keep single-purpose images and still compose them — which is exactly what makes the sidecar pattern, and therefore service meshes, possible.
4. **It is the atomic unit of the shared context** — namespaces, cgroups parent, volumes. Kubernetes needs one object whose lifecycle bounds all of that.

**The trade-off, stated honestly:** the Pod is also the unit of **scaling** and **failure**. Everything in a Pod scales together and restarts together. So a sidecar that is not genuinely coupled to the app — a batch job, an unrelated service, a second API — does not belong in the same Pod; it belongs in its own Deployment. "Should this scale independently?" is the test. The most common anti-pattern is a multi-container Pod used as a convenience wrapper for things that should have been separate workloads.

---

## Q4. What is a Deployment?

**Per the documentation:** *"A Deployment manages a set of Pods to run an application workload, usually one that doesn't maintain state."* And: *"You describe a desired state in a Deployment, and the Deployment Controller changes the actual state to the desired state at a controlled rate."*

**The chain of ownership:** `Deployment → ReplicaSet → Pods`. You edit the Deployment; it creates a **new ReplicaSet** for the new pod template and scales the old one down — which is what makes rollback trivial, because the old ReplicaSet still exists with its spec intact.

**What it gives you:**

| Capability | Mechanism |
|---|---|
| **Rolling updates** | `strategy.rollingUpdate.maxSurge` / `maxUnavailable` (default 25 % each) |
| **Rollback** | `kubectl rollout undo` — reverts to a prior ReplicaSet; history kept per `revisionHistoryLimit` |
| **Self-healing** | ReplicaSet controller recreates lost Pods |
| **Scaling** | `replicas`, or driven by an HPA |
| **Progress detection** | `progressDeadlineSeconds` marks a stuck rollout as failed rather than hanging forever |

**Production-grade settings people omit, and each has a real failure behind it:**

```yaml
spec:
  replicas: 3
  strategy:
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }   # never lose capacity mid-rollout
  minReadySeconds: 10                                    # a pod must stay Ready this long to count
  progressDeadlineSeconds: 600
  template:
    spec:
      terminationGracePeriodSeconds: 60                  # long enough to drain in-flight requests
      topologySpreadConstraints:                         # don't land all replicas in one AZ
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector: { matchLabels: { app: payments-api } }
```
Plus a **PodDisruptionBudget** (`minAvailable: 2`), which is what stops a node drain or cluster upgrade from taking every replica at once. `maxUnavailable: 0` plus a PDB is the combination that makes rollouts and node maintenance invisible to callers.

**Other workload controllers to distinguish:** **ReplicaSet** (managed by Deployment; don't create directly), **StatefulSet** (Q5), **DaemonSet** (one Pod per node — log agents, CNI, node exporters), **Job** / **CronJob** (run-to-completion and scheduled work).

---

## Q5. Deployment vs StatefulSet?

**Per the documentation:** *"StatefulSet is the workload API object used to manage stateful applications. Manages the deployment and scaling of a set of Pods, and provides guarantees about the ordering and uniqueness of these Pods."* And: *"A StatefulSet runs a group of Pods, and maintains a sticky identity for each of those Pods."*

| | **Deployment** | **StatefulSet** |
|---|---|---|
| Pod identity | **Interchangeable**, random suffix (`api-7d9f-x8k2`) | **Stable and ordinal** (`kafka-0`, `kafka-1`) — survives rescheduling |
| Network identity | Service load-balances across Pods | **Stable DNS per Pod** via a **headless Service** (`kafka-0.kafka.ns.svc`) |
| Storage | Usually none, or a shared volume | **`volumeClaimTemplates`** — each Pod gets its **own** PVC, reattached to the same ordinal |
| Startup / scaling order | Parallel | **Ordered 0→N-1**; scale-down N-1→0 |
| Rolling update | Any order | **Ordered**, with `partition` for staged rollouts |
| Deleting the workload | Pods go, that's it | **PVCs are deliberately NOT deleted** — data safety |

**The four documented guarantees:** stable unique network identifiers; stable persistent storage; ordered graceful deployment and scaling; ordered automated rolling updates.

**Use a StatefulSet when the identity matters to the application itself:** a Kafka broker whose partition assignments are tied to its ID, a Zookeeper/etcd member in a quorum, a PostgreSQL primary/replica pair, Elasticsearch data nodes, Redis Cluster. In every case the software has a notion of "which node am I" and needs the same disk back after a restart.

**Use a Deployment for everything else** — which, in a .NET microservices estate, is almost everything. Stateless web APIs, workers, gRPC services.

**Limitations from the docs that you should raise unprompted:** storage must come from a provisioner or be pre-provisioned; **scaling down or deleting a StatefulSet does not delete the volumes**, so you own that cleanup and its cost; a **headless Service must be created by you**; and rolling updates under the default `OrderedReady` pod-management policy **can get stuck in a broken state requiring manual intervention** — a Pod that never becomes Ready blocks the whole rollout.

**The architect-level opinion worth voicing:** the ability to run a database on Kubernetes is not the same as the advisability of it. On AWS, **RDS/Aurora, MSK and ElastiCache are usually the better answer** than a self-operated StatefulSet — you are not paid to operate a database, and a StatefulSet gives you the scheduling primitives but none of the backup, failover, patching and recovery expertise. Run StatefulSets when there is no managed equivalent, or when a genuine portability mandate forces it, and then invest in a mature **operator** rather than raw manifests.

---

## Q6. What is a Service?

**Per the documentation:** *"In Kubernetes, a Service is a method for exposing a network application that is running as one or more Pods in your cluster."* And: *"The Service API… is an abstraction to help you expose groups of Pods over a network. Each Service object defines a logical set of endpoints (usually these endpoints are Pods) along with a policy about how to make those pods accessible."*

**The problem it solves:** Pod IPs are ephemeral. Pods are created, killed, rescheduled and replaced constantly, each time with a new IP. A Service provides a **stable virtual IP and DNS name** in front of a changing set of Pods.

**How it works, end to end:**

```
Service (stable ClusterIP + DNS: payments.prod.svc.cluster.local)
   │  selector: app=payments
   ▼
EndpointSlice controller  ──watches Pods matching the selector and READY──▶ list of Pod IP:port
   ▼
kube-proxy (iptables / IPVS) or an eBPF dataplane on every node
   ▼
Pod IPs — traffic DNAT'd to one of them
```

**Details that matter in practice:**

- **Only Ready Pods are endpoints.** This is the mechanical link between the readiness probe (Q16) and traffic: a failing readiness probe removes the Pod's IP from the EndpointSlice, so no traffic reaches it. It is also why a missing readiness probe sends traffic to a still-starting Pod.
- **`port` vs `targetPort` vs `nodePort`** — the Service port clients use, the container port behind it, and the node port for NodePort type. If `targetPort` is omitted it defaults to `port`.
- **DNS** — `<service>.<namespace>.svc.cluster.local`, resolved by CoreDNS. Within a namespace, the short name suffices.
- **Headless Service** (`clusterIP: None`) — no virtual IP; DNS returns the **Pod IPs directly**. This is what StatefulSets use, and what a client-side load-balancing gRPC client wants.
- **Load balancing is L4 and connection-level.** kube-proxy balances *connections*, not requests. With HTTP/2 or gRPC — which multiplex many requests over one long-lived connection — traffic pins to whichever Pod the connection landed on, and you get badly skewed load. **The fix is client-side load balancing over a headless Service, or a service mesh / L7 proxy.** This is one of the highest-value things to know about Kubernetes networking, and it bites .NET gRPC services in particular.
- **`ExternalName`** — a CNAME to an external DNS name; useful for pointing a stable in-cluster name at a managed RDS endpoint.

---

## Q7. ClusterIP vs NodePort vs LoadBalancer?

The three types form a **stack** — each builds on the one before it, and saying that first is the cleanest way to answer.

| | **ClusterIP** (default) | **NodePort** | **LoadBalancer** |
|---|---|---|---|
| Per the docs | *"Exposes the Service on a cluster-internal IP"* | *"Exposes the Service on each Node's IP at a static port"* | *"Exposes the Service externally using an external load balancer"* |
| Reachable from | **Inside the cluster only** | Outside, via `<NodeIP>:<NodePort>` | Outside, via a cloud LB with its own address |
| Port | Any | **30000–32767** | Any (LB listener) |
| Builds on | — | Allocates a ClusterIP too | Allocates a ClusterIP **and** a NodePort too |
| Cloud resource | None | None | **One cloud load balancer per Service** |
| Cost | Free | Free | **~$16–25/month each**, plus LCU/data |
| Production use | **Almost everything** — internal service-to-service | Rarely direct; the plumbing under an ingress controller or on bare metal | Ingress controllers, and non-HTTP services needing external exposure |

**Plus `ExternalName`**, the fourth type: no proxying at all, just a CNAME to an external DNS name.

**The problem with LoadBalancer as a general answer, and the reason Ingress exists:** one cloud load balancer *per Service*. Fifty microservices means fifty load balancers, fifty public endpoints, fifty certificates and a bill nobody enjoys explaining. On EKS the AWS Load Balancer Controller does provision an NLB per LoadBalancer Service, so this is a real cost, not a theoretical one.

**What I actually deploy:**
- **ClusterIP** for every internal service — the default and correct choice.
- **One LoadBalancer** (an NLB) fronting the **ingress controller**, with everything else routed behind it by host/path.
- **NodePort** essentially never on its own in a cloud environment; it exists mainly as the mechanism underneath, and for bare-metal clusters (where MetalLB fills the LoadBalancer role).
- **Headless (`clusterIP: None`)** for StatefulSets and for gRPC client-side load balancing.

**On EKS specifically:** the **AWS Load Balancer Controller** provisions an **NLB** for a `LoadBalancer` Service (annotation `service.beta.kubernetes.io/aws-load-balancer-type: external`) and an **ALB** for an Ingress. In **IP target mode** the load balancer targets Pod IPs directly, skipping the kube-proxy hop — lower latency, correct client IPs, and it is what you want for anything performance-sensitive.

---

## Q8. What is Ingress?

**Per the documentation:** *"Ingress exposes HTTP and HTTPS routes from outside the cluster to services within the cluster. Traffic routing is controlled by rules defined on the Ingress resource."*

**The critical mechanical fact:** *"You must have an Ingress controller to satisfy an Ingress. Only creating an Ingress resource has no effect."* The Ingress object is a **declarative routing spec**; a controller (NGINX Ingress, AWS Load Balancer Controller, Traefik, HAProxy, Istio Gateway) watches it and programs actual infrastructure.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: payments
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:eu-west-1:111122223333:certificate/…
    alb.ingress.kubernetes.io/wafv2-acl-arn: arn:aws:wafv2:…
spec:
  ingressClassName: alb
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /payments
            pathType: Prefix
            backend: { service: { name: payments, port: { number: 80 } } }
          - path: /accounts
            pathType: Prefix
            backend: { service: { name: accounts,  port: { number: 80 } } }
  tls: [{ hosts: [api.example.com], secretName: api-tls }]
```

**What Ingress buys you:** **one load balancer for many services**, host- and path-based routing, TLS termination with certificate management (cert-manager, or ACM on ALB), and a single place to attach WAF, auth and rate limiting.

**Its acknowledged weakness — and the modern successor:** Ingress is HTTP/HTTPS-only, and everything beyond basic routing is expressed in **controller-specific annotations**, which are unportable and untyped. The Kubernetes project's answer is the **Gateway API** (`GatewayClass` / `Gateway` / `HTTPRoute`), which is GA for its core resources, is role-oriented (infrastructure team owns the Gateway, app teams own their Routes), supports non-HTTP protocols, and expresses header-based routing, traffic splitting and mirroring as **first-class fields rather than annotations**. On AWS it is implemented by the Load Balancer Controller and by **VPC Lattice**. For a new platform in 2026 I would design toward Gateway API and treat Ingress as the compatibility layer — naming this is a strong currency signal in an interview.

---

## Q9. Ingress vs LoadBalancer?

They operate at different layers and are usually **combined**, not chosen between.

| | **Service type LoadBalancer** | **Ingress** |
|---|---|---|
| Layer | **L4** (TCP/UDP) | **L7** (HTTP/HTTPS) |
| Object | A Service | A separate resource + a controller |
| Ratio | **One cloud LB per Service** | **One cloud LB for many Services** |
| Routing | Port only | **Host, path, header, method** |
| TLS | Pass-through or LB-level | **Terminates**, with certificate management |
| Protocols | Any TCP/UDP | HTTP/HTTPS only |
| Cost at 50 services | 50 load balancers | **1** |
| Extras | None | Rewrites, redirects, auth, rate limiting, WAF, canary splitting |

**How they actually fit together:**

```
Internet
   │
   ▼
Service type=LoadBalancer  ← the ingress controller's own Service (ONE cloud LB)
   │
   ▼
Ingress controller Pods (NGINX / ALB controller / Envoy)
   │  routes by host + path per Ingress rules
   ├──▶ ClusterIP Service: payments ──▶ Pods
   ├──▶ ClusterIP Service: accounts ──▶ Pods
   └──▶ ClusterIP Service: reporting ─▶ Pods
```
So the answer to "which do I use?" is: **one** LoadBalancer Service (for the controller) and **many** Ingress resources.

**When you genuinely need a LoadBalancer Service instead of Ingress:** non-HTTP traffic (a FIX gateway over raw TCP, a UDP service, SMTP), TLS pass-through where the application must terminate mTLS itself, or a case needing a static/Elastic IP for counterparty allow-listing. On EKS the AWS Load Balancer Controller makes this concrete: **Ingress → ALB**, **LoadBalancer Service → NLB**.

---

## Q10. What is ConfigMap?

**Per the documentation:** *"A ConfigMap is an API object used to store non-confidential data in key-value pairs. Pods can consume ConfigMaps as environment variables, command-line arguments, or as configuration files in a volume."*

And the explicit warning: *"A ConfigMap is not designed to hold large chunks of data. The data stored in a ConfigMap cannot exceed 1 MiB."* Also: *"ConfigMap does not provide secrecy or encryption."*

**Three consumption modes, and the difference matters operationally:**

| Mode | Behaviour on update |
|---|---|
| **Environment variables** (`envFrom` / `valueFrom.configMapKeyRef`) | **Never updated** — the Pod must be restarted |
| **Volume mount** | **Updated automatically** (eventually, via kubelet sync — typically ~1 minute), if not using `subPath` |
| **Command-line args** | Fixed at start |

```yaml
apiVersion: v1
kind: ConfigMap
metadata: { name: payments-config }
data:
  Logging__LogLevel__Default: "Information"
  ConnectionStrings__Ledger: "Host=aurora.internal;Database=ledger"
  appsettings.Production.json: |
    { "Retry": { "MaxAttempts": 3, "BackoffMs": 200 } }
```

**For .NET specifically:** `ASPNETCORE`-style hierarchical configuration maps onto environment variables with the **double-underscore separator** (`Logging__LogLevel__Default`), so a ConfigMap's keys drop straight into `IConfiguration` with no code. Mounting an `appsettings.Production.json` as a file and adding it via `AddJsonFile(..., reloadOnChange: true)` gives you live reload — and combined with `IOptionsMonitor<T>` you get configuration changes without a restart. Say that in an interview; it is the concrete .NET answer most candidates miss.

**Production practices:**
- **Immutable ConfigMaps** (`immutable: true`) reduce API-server watch load significantly at scale and prevent accidental edits — but require a new name to change, which pairs naturally with:
- **Content-hash the ConfigMap name** (`payments-config-7f3a1c`) and reference it from the Deployment, so a config change produces a **new pod template and therefore a real, rollback-able rollout**. Otherwise a config change silently takes effect at different times on different Pods, which is exactly the sort of drift that produces an unreproducible incident.
- Keep configuration **per environment**, in Git, applied by the same pipeline as code (Kustomize overlays or Helm values). Nothing edited by hand in a cluster.
- **Never put secrets in a ConfigMap** — it is unencrypted, broadly readable, and frequently dumped into logs and dashboards.

---

## Q11. What is a Kubernetes Secret?

**Per the documentation:** *"A Secret is an object that contains a small amount of sensitive data such as a password, a token, or a key. Such information might otherwise be put in a Pod specification or in a container image."*

**And the warning that is the entire point of the question — quote it, because most candidates get this wrong:**

> *"Kubernetes Secrets are, by default, stored unencrypted in the API server's underlying data store (etcd). Anyone with API access can retrieve or modify a Secret, and so can anyone with access to etcd."*

**base64 is encoding, not encryption.** `echo <value> | base64 -d` is the entire attack. A Secret differs from a ConfigMap mainly in intent, in a few handling behaviours (not written to disk unencrypted on the node — `tmpfs`-backed volumes; not shown by default in `kubectl describe`), and in being a distinct RBAC-able resource type.

**The four steps the documentation says you must take at minimum:**

1. **Enable encryption at rest** for Secrets (an `EncryptionConfiguration` on the API server; on EKS, **envelope encryption with a KMS key**).
2. **Enable/configure RBAC rules with least-privilege access** to Secrets.
3. **Restrict Secret access to specific containers.**
4. **Consider using external Secret store providers** — e.g. the **Secrets Store CSI Driver**.

**Built-in types** worth knowing: `Opaque` (default), `kubernetes.io/tls`, `kubernetes.io/dockerconfigjson` (image pull), `kubernetes.io/service-account-token`, `kubernetes.io/basic-auth`, `kubernetes.io/ssh-auth`.

**Consumption:** environment variable (static for the Pod's life, and **leaks into crash dumps, `/proc`, and anything that prints the environment**) or **volume mount** (updated when the Secret changes, `tmpfs`-backed). **Prefer volume mounts** for anything rotatable.

Question 12 covers what to do instead of relying on native Secrets.

---

## Q12. How should secrets be managed securely?

Layered, and the layers correspond directly to the documentation's four recommendations plus what production actually requires.

**1. Never in Git, never in the image.** Not in `appsettings.json`, not in a Dockerfile `ENV`, not in a Helm `values.yaml` committed to a repo. Enforce with pre-commit scanning (gitleaks, `git-secrets`) and CI checks — a leaked credential in history is a rotation event, not a `git rm`.

**2. Use an external secret store as the source of truth.** This is the architectural answer.

| Approach | How it works | Trade-off |
|---|---|---|
| **Secrets Store CSI Driver** + AWS provider | Secret is fetched from **Secrets Manager / Parameter Store** at Pod start and mounted as a **`tmpfs` file**; supports rotation-on-poll | **Never stored in etcd at all** — the strongest option; adds a driver to operate |
| **External Secrets Operator** | Syncs from Secrets Manager/Vault **into** native K8s Secrets | Simplest to adopt, works with everything expecting a Secret — but the value does land in etcd |
| **HashiCorp Vault** (agent injector or CSI) | Dynamic, short-lived credentials; one secrets plane across cloud and data centre | Most capable; most to operate. Common in banks |
| **IRSA / EKS Pod Identity** | **No secret at all** — the workload assumes an IAM role and gets temporary STS credentials | **Best of all: the secret ceases to exist.** Use for every AWS API call |

**The strongest single move is point four:** most "secrets" in a cloud-native .NET service are AWS credentials, and with **IRSA** (IAM Roles for Service Accounts, via OIDC federation) or **EKS Pod Identity** there is no credential to store, rotate or leak — the AWS SDK's default credential chain picks up temporary credentials automatically. Reduce the secret inventory before you improve secret storage.

**3. Harden the cluster's own handling.**
- **Encryption at rest** — on EKS, envelope encryption with a **customer-managed KMS key** so etcd contents are encrypted with a key you control and every use is CloudTrail-logged.
- **RBAC**: no wildcard `secrets` access; `get`/`list` on Secrets is effectively "read all credentials in the namespace". `list` is as dangerous as `get`.
- **Disable automatic ServiceAccount token mounting** (`automountServiceAccountToken: false`) where it isn't needed.
- **Prefer volume mounts to environment variables** — env vars leak into crash dumps, logs, error pages and child processes.
- **Namespace isolation** — Secrets are namespace-scoped; that is your primary boundary.

**4. Rotate, and make rotation a non-event.** Secrets Manager automatic rotation with the two-user strategy for databases; short-lived, dynamic credentials from Vault where available; and in the application, catch an auth failure, force a refresh of the cached credential, retry once. If rotation requires a coordinated deployment, it will not happen on schedule.

**5. Detect.** Audit-log all Secret access (EKS control-plane audit logs → CloudWatch), alert on unusual `get`/`list` volume against Secrets, and scan images and running workloads for embedded credentials.

**The answer in one line:** *the best-managed secret is the one that does not exist* — use workload identity (IRSA/Pod Identity) wherever possible, an external store with CSI mounting for the rest, encryption at rest and tight RBAC underneath both, and automated rotation over everything.

---

## Q13. What is a Service Account?

**Per the documentation:** *"A service account is a type of non-human account that, in Kubernetes, provides a distinct identity in a Kubernetes cluster. Application Pods, system components, and entities inside and outside the cluster can use a specific ServiceAccount's credentials to identify as that ServiceAccount."*

**The essentials:**

- Namespaced. Every namespace has a **`default`** ServiceAccount, and any Pod that doesn't specify one gets it.
- A Pod's ServiceAccount is the identity the **API server** authenticates when that Pod calls the Kubernetes API — so it is the subject that **RBAC** (Q14) binds permissions to.
- Since v1.22+, tokens are **short-lived, audience-bound, automatically rotated projected volumes** (the `TokenRequest` API), not the old permanent Secret-based tokens. Long-lived ServiceAccount token Secrets still exist but should be avoided.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: payments-api
  namespace: prod
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::111122223333:role/payments-api-irsa   # IRSA
---
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      serviceAccountName: payments-api
      automountServiceAccountToken: false   # if the app never calls the K8s API
```

**Two disciplines that matter:**

1. **One ServiceAccount per workload.** Never share, never use `default`. It is the only way RBAC and IRSA can be least-privilege, and the only way an audit log attributes an action to a specific service.
2. **Turn off token automounting when unused.** Most application Pods never call the Kubernetes API; mounting a token into them is free credential exposure if the container is compromised.

**On EKS, the ServiceAccount is also the AWS identity boundary.** **IRSA** federates the cluster's OIDC provider into IAM: the annotated ServiceAccount's projected token is exchanged via `sts:AssumeRoleWithWebIdentity` for temporary AWS credentials, scoped to that Pod. **EKS Pod Identity** is the newer, simpler mechanism (an association between a ServiceAccount and an IAM role via an EKS API, no per-cluster OIDC provider or trust-policy editing, and it works across clusters). Either way, the payoff is the same and it is worth stating explicitly: **per-workload AWS permissions instead of per-node**, so a compromised Pod cannot use the node role to reach everything else's data.

---

## Q14. What is Kubernetes RBAC?

**Per the documentation:** *"Role-based access control (RBAC) is a method of regulating access to computer or network resources based on the roles of individual users within your organization."* RBAC uses the `rbac.authorization.k8s.io` API group *"to drive authorization decisions, allowing you to dynamically configure policies through the Kubernetes API."*

**Four objects, two axes — namespace-scoped vs cluster-scoped, and role vs binding:**

| Object | Scope | Purpose |
|---|---|---|
| **Role** | Namespace | Permissions **within one namespace** |
| **ClusterRole** | Cluster | Permissions cluster-wide, on cluster-scoped resources (nodes, PVs), on non-resource endpoints (`/healthz`), or as a reusable template |
| **RoleBinding** | Namespace | Grants a Role **or a ClusterRole** to subjects, **limited to that namespace** |
| **ClusterRoleBinding** | Cluster | Grants a ClusterRole **across all namespaces** |

The combination worth calling out: a **RoleBinding referencing a ClusterRole** grants those permissions only within the binding's namespace — that is how you define `view`/`edit` once and reuse it per team without granting cluster-wide access.

```yaml
kind: Role
metadata: { namespace: prod, name: payments-operator }
rules:
  - apiGroups: [""]        , resources: ["pods","pods/log"], verbs: ["get","list","watch"]
  - apiGroups: ["apps"]    , resources: ["deployments"]    , verbs: ["get","list","watch","patch"]
---
kind: RoleBinding
metadata: { namespace: prod, name: payments-oncall }
subjects: [{ kind: Group, name: "payments-oncall", apiGroup: rbac.authorization.k8s.io }]
roleRef: { kind: Role, name: payments-operator, apiGroup: rbac.authorization.k8s.io }
```

**The property that shapes every design decision, quoted from the docs:** *"Permissions are purely additive (there are no 'deny' rules)."* You cannot revoke with RBAC — only avoid granting. So least privilege must be built from the empty set upward, and anything requiring a *deny* (block privileged pods, block a namespace, enforce image provenance) belongs to **admission control** — Pod Security Admission, or a policy engine like **Kyverno** or **OPA Gatekeeper**.

**Practical rules:**
- Never bind `cluster-admin` to a workload, a CI pipeline, or a human's day-to-day account.
- Watch the escalation paths: `create pods` in a namespace ≈ the node's identity; `get secrets` ≈ every credential in that namespace; `escalate`/`bind`/`impersonate` are privilege-escalation verbs; `create` on `pods/exec` is a shell in production.
- Bind to **groups**, not users — mapped from your IdP (on EKS, IAM principals via **EKS access entries** or the older `aws-auth` ConfigMap).
- Audit with `kubectl auth can-i --list --as=system:serviceaccount:prod:payments-api`, and periodically with `rbac-tool`/`kubectl-who-can`.
- **On EKS there are two layers:** IAM decides who may call the EKS *API* (including `eks:AccessKubernetesApi`), and Kubernetes RBAC decides what they may do *inside* the cluster. Both must allow the action. Candidates routinely conflate them.

---

## Q15. What are liveness probes?

**Per the documentation:** *"Liveness probes determine when to restart a container. For example, liveness probes could catch a deadlock when an application is running but unable to make progress."*

**Mechanism:** the kubelet runs the probe periodically for the container's whole life. After `failureThreshold` consecutive failures, **the kubelet kills the container** and the `restartPolicy` applies. It restarts the *container*, not the Pod — the Pod object and its IP stay; the restart count increments.

```yaml
livenessProbe:
  httpGet: { path: /health/live, port: 8080 }
  initialDelaySeconds: 0        # prefer a startupProbe over a long delay here
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3
```

**Four probe mechanisms:** `httpGet` (success = **2xx or 3xx**), `tcpSocket` (port opens), `exec` (exit code 0), and `grpc` (the standard gRPC health checking protocol returning `SERVING`). The docs specifically warn that `exec` probes fork a process on every execution and add real overhead in high-density clusters — prefer `httpGet`.

**The documentation's own caution, and the heart of this question:** *"Incorrect implementation of liveness probes can result in cascading failures."* Here is the failure mode, and it is a classic production outage:

> The liveness endpoint checks the database. The database gets slow. Every Pod's liveness probe fails simultaneously. Kubernetes restarts **every** Pod at once. Cold caches and reconnection storms make the database slower. The restarts continue. A degraded dependency has become a total outage — caused by the health check, not the fault.

**Therefore the design rules:**

1. **A liveness probe must check only "is this process irrecoverably stuck?"** — never dependencies. Dependency health belongs in **readiness**, which removes traffic instead of destroying the process.
2. **Restarting must plausibly fix it.** If a restart can't help, don't have a liveness probe do it.
3. **Be conservative** — longer `periodSeconds`, higher `failureThreshold` than readiness. Restarting is the most destructive action available to the kubelet.
4. **Many services need no liveness probe at all.** If the process crashes on failure, the container restarts anyway. Add liveness for genuine hang risks — deadlocks, thread-pool exhaustion, a wedged event loop.

**In ASP.NET Core** this maps directly onto the health-checks middleware with tags, which is the concrete implementation to cite:

```csharp
builder.Services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])
    .AddNpgSql(cs,   name: "ledger-db",  tags: ["ready"])
    .AddRedis(redis, name: "cache",      tags: ["ready"]);

app.MapHealthChecks("/health/live",  new() { Predicate = c => c.Tags.Contains("live")  });
app.MapHealthChecks("/health/ready", new() { Predicate = c => c.Tags.Contains("ready") });
```

---

## Q16. What are readiness probes?

**Per the documentation:** *"Readiness probes determine when a container is ready to start accepting traffic. This is useful when waiting for an application to perform time-consuming initial tasks, such as establishing network connections, loading files, and warming caches."*

**Mechanism, and it is entirely different from liveness:** on failure the container is **not restarted**. Instead *"the EndpointSlice controller removes the Pod's IP address from the endpoints of all Services that match the Pod"* — the Pod stays alive and simply stops receiving traffic. When the probe passes again, it is added back.

**This makes readiness the correct place for dependency checks.** If the database is briefly unreachable, the Pod goes Not Ready, traffic drains to healthy replicas, and the Pod recovers on its own — no restart, no cold start, no cascade.

**Where readiness is load-bearing:**

| Situation | Effect |
|---|---|
| **Startup** | Traffic isn't sent until the app is genuinely ready — JIT warmed, connection pool filled, caches loaded |
| **Rolling update** | A new Pod counts as available only when Ready, so `maxUnavailable: 0` genuinely preserves capacity |
| **Transient dependency failure** | Traffic drains rather than errors |
| **Graceful shutdown** | Fail readiness first, wait, *then* stop accepting work — the standard drain sequence (Q22/Q30) |
| **Overload shedding** | Fail readiness when the queue depth is beyond recovery, to shed load deliberately |

**The trap to name:** if **every** replica's readiness depends on a shared dependency, a blip in that dependency takes **all** replicas out of service at once — a self-inflicted total outage. Mitigate by distinguishing *hard* dependencies (no useful work possible without it — the primary database) from *soft* ones (cache, a recommendations service — degrade instead), and only failing readiness on hard ones. That distinction, made explicitly, is what a senior panel is listening for.

**Configuration in practice:** `periodSeconds: 5`, `failureThreshold: 3`, `timeoutSeconds: 2`, `successThreshold: 1`. Faster and more sensitive than liveness, because the consequence — removing one Pod from rotation — is cheap and reversible.

---

## Q17. Startup probe vs liveness probe?

**Per the documentation:** *"Startup probes verify whether the application within a container is started. This can be used to adopt liveness checks on slow-starting containers, avoiding them getting killed by the kubelet before they are up and running."* Crucially: *"Kubernetes does not execute liveness or readiness probes until the startup probe succeeds."*

| | **Startup probe** | **Liveness probe** |
|---|---|---|
| Runs | **Only during startup**, until it first succeeds | **Continuously**, for the container's whole life |
| Question | "Has it finished starting?" | "Is it still working?" |
| On failure | Kills the container (restart policy applies) | Kills the container (restart policy applies) |
| Effect on other probes | **Suspends liveness and readiness** until it passes | None |
| Then | **Never runs again** | Keeps running |

**The problem it solves.** Before startup probes, a slow-starting app forced you to choose badly: either set `initialDelaySeconds` high on the liveness probe — which then delays detection of a *real* hang for the container's entire life — or watch the kubelet kill the app mid-startup, forever, in a restart loop. The startup probe decouples the two budgets: a **generous** startup window and a **tight** liveness check afterwards.

```yaml
startupProbe:                          # allow up to 30 × 10s = 300 s to start
  httpGet: { path: /health/live, port: 8080 }
  failureThreshold: 30
  periodSeconds: 10
livenessProbe:                         # once started, detect a hang within ~30 s
  httpGet: { path: /health/live, port: 8080 }
  periodSeconds: 10
  failureThreshold: 3
```

**The startup budget is `failureThreshold × periodSeconds`** — size it from measured p99 cold-start time with headroom, not from a guess. Too small and you get an infinite restart loop that looks exactly like a crash (Q22).

**When to add one, per the docs' guidance:** whenever startup can exceed `initialDelaySeconds + failureThreshold × periodSeconds` of the liveness probe. In practice: JVM services, large .NET apps doing EF Core model building and JIT warm-up, anything loading a large dataset or ML model, and anything running migrations at boot. For a typical ASP.NET Core API on a warm image, startup is a few seconds and a startup probe is optional — but adding one costs nothing and removes a whole class of incident on a bad day when the cluster is slow.

---

## Q18. What is HPA?

**Per the documentation:** *"In Kubernetes, a HorizontalPodAutoscaler automatically updates a workload resource (such as a Deployment or StatefulSet), with the aim of automatically scaling capacity to match demand."*

**Horizontal vs vertical, in the docs' own framing:** horizontal scaling means **deploying more Pods**; vertical scaling means **giving existing Pods more resources** (that is the **VPA**, a separate component, and note that HPA on CPU/memory and VPA on the same resource conflict — don't run both on the same metric).

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: payments-api }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: payments-api }
  minReplicas: 3
  maxReplicas: 40
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 60 } }
    - type: External                      # scale on real demand, not a proxy for it
      external:
        metric: { name: sqs_approximate_number_of_messages_visible }
        target: { type: AverageValue, averageValue: "30" }
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300     # slow down, to avoid flapping
      policies: [{ type: Percent, value: 50, periodSeconds: 60 }]
    scaleUp:
      stabilizationWindowSeconds: 0       # up fast
      policies: [{ type: Percent, value: 100, periodSeconds: 30 }]
```

**Two prerequisites people forget:** the **Metrics Server** must be installed for CPU/memory metrics (`metrics.k8s.io`), and **the Pods must declare CPU requests** — utilisation is computed *as a percentage of the request*, so with no request there is nothing to compute and the HPA reports `<unknown>`.

**What it cannot scale, per the docs:** objects that can't be scaled, such as a **DaemonSet**.

**And the limitation that matters most architecturally:** HPA adds Pods; it does not add **nodes**. If the cluster has no room, the new Pods sit `Pending`. Node capacity comes from **Cluster Autoscaler** or, on EKS, **Karpenter** (which provisions right-sized nodes directly from pending-pod requirements, in ~a minute, and consolidates them afterwards — the better default for a modern EKS cluster). A complete answer names both layers, plus **KEDA** for event-driven scaling (SQS depth, Kafka consumer lag, Service Bus) including **scale-to-zero**, which plain HPA cannot do.

---

## Q19. How does HPA work?

**The control loop.** The HPA controller runs on an interval — *"the interval is set by the `--horizontal-pod-autoscaler-sync-period` parameter to the kube-controller-manager. The default period is 15 seconds."* Each cycle it queries metrics for the Pods of the target workload, computes a desired replica count, and patches the workload's `scale` subresource.

**The algorithm, as documented:**

```
desiredReplicas = ceil[ currentReplicas × ( currentMetricValue / desiredMetricValue ) ]
```

**Worked example.** 10 Pods, CPU target 60 %, current average 90 %:
`ceil(10 × 90/60) = ceil(15) = 15` replicas. If utilisation later drops to 30 %: `ceil(10 × 30/60) = 5`.

**Damping and safety mechanisms:**

| Mechanism | Effect |
|---|---|
| **Tolerance** (default **0.1**) | The ratio must differ from 1.0 by more than 10 % before any action — stops thrashing around the target |
| **Stabilization window** | `scaleDown` defaults to **300 s**; the controller uses the highest recommendation in the window, so it scales down slowly and up quickly |
| **Scaling policies** (`behavior`) | Cap the rate — e.g. "at most 100 % increase per 30 s", "at most 50 % decrease per 60 s" |
| **Not-ready / missing-metric Pods** | Excluded or treated conservatively so a starting Pod's low CPU doesn't suppress scale-up |
| **`minReplicas` / `maxReplicas`** | Hard bounds; `maxReplicas` is your blast-radius and cost guard |

**Metric types supported:** per-Pod **resource** metrics (CPU/memory from `metrics.k8s.io`), per-Pod **custom** metrics (`custom.metrics.k8s.io`, raw values), and **object/external** metrics (`external.metrics.k8s.io`) — the last is how you scale on a queue depth or an SLO-relevant signal rather than on CPU.

**The architect's point, which is where this question is really going:** **CPU is a poor scaling signal for I/O-bound services.** An async .NET API waiting on a database or an external payment provider can be fully saturated on connections and threads while sitting at 20 % CPU — the HPA will never scale it, and latency climbs while the dashboard looks calm. Scale on the signal that actually represents demand: **requests per second, concurrent in-flight requests, p99 latency, or queue depth/consumer lag** via KEDA or a custom metrics adapter (Prometheus Adapter, CloudWatch adapter). Then set `minReplicas` from your availability floor (≥3, spread across AZs) rather than from cost, because scaling up takes time you may not have during a spike.

---

## Q20. Requests vs limits?

**Per the documentation:** *"When you specify the resource request for containers in a Pod, the kube-scheduler uses this information to decide which node to place the Pod on."* Limits, by contrast, are enforced at runtime — and **the enforcement differs fundamentally between CPU and memory**, which is the crux of this question.

| | **Request** | **Limit** |
|---|---|---|
| Used by | **Scheduler** — placement and bin-packing | **kubelet / kernel** — runtime enforcement |
| Meaning | Guaranteed minimum; reserved on the node | Hard ceiling |
| Affects | Which node, QoS class, HPA utilisation base, eviction order | Throttling (CPU) / OOM kill (memory) |
| If omitted | Scheduler assumes ~0 → node oversubscription and eviction | Container can consume the whole node |

**CPU — compressible, per the docs:** *"cpu limits are enforced by CPU throttling. When a container approaches its cpu limit, the kernel will restrict access to the CPU corresponding to the container's limit. Thus, a cpu limit is a hard limit the kernel enforces."* The container is **throttled, never killed**. It just gets slower.

**Memory — incompressible, per the docs:** *"memory limits are enforced by the kernel with out of memory (OOM) kills. When a container uses more than its memory limit, the kernel may terminate it."* You cannot throttle memory; you can only refuse it. Hence `OOMKilled` (Q21).

**QoS classes**, derived automatically from requests and limits, and they determine **eviction order under node pressure**:

| Class | Condition | Evicted |
|---|---|---|
| **Guaranteed** | Every container has requests **==** limits, for both CPU and memory | **Last** |
| **Burstable** | At least one request or limit set, but not Guaranteed | Middle |
| **BestEffort** | No requests or limits at all | **First** |

**The recommendation I would defend in an interview, because it is contested and I want to show I know why:**

> **Always set memory requests == memory limits. Set CPU requests, and usually omit CPU limits.**

Reasoning: memory is incompressible, so a memory limit is a genuine correctness boundary and equality makes behaviour predictable and the QoS class Guaranteed. CPU is compressible, so a CPU *limit* buys you nothing except **CFS throttling** — and throttling is a well-documented source of mysterious p99 latency spikes, because a container can be throttled even when the node is idle, purely because it exhausted its quota within a 100 ms period. For latency-sensitive services, CPU requests (for scheduling and fair-share) with no limit generally gives better tail latency. Where multi-tenancy or a hard cost boundary demands CPU limits, set them generously and **watch `container_cpu_cfs_throttled_seconds_total`**.

**Governance:** enforce with **LimitRange** (per-namespace defaults and maxima) and **ResourceQuota** (total namespace consumption), so an unset request cannot reach production. And size from measurement — VPA in *recommendation* mode, or observed p99 usage — not from a round number someone typed once.

---

## Q21. What is OOMKilled?

**`OOMKilled` (exit code 137 = 128 + SIGKILL/9)** means the **Linux kernel's OOM killer terminated the container** because it exceeded its memory cgroup limit — or because the node itself ran out of memory. Per the documentation, memory limits *"are enforced by the kernel with out of memory (OOM) kills… a container may use more memory than its memory limit, but if it does, it may get killed."*

```bash
kubectl describe pod payments-api-7d9f-x8k2
# Last State:  Terminated
#   Reason:    OOMKilled
#   Exit Code: 137
kubectl get events --field-selector reason=OOMKilling
```

**Two distinct cases, and distinguishing them is the diagnostic:**

| | **Container OOM** | **Node OOM / eviction** |
|---|---|---|
| Cause | This container exceeded **its own** memory limit | The **node** ran out; kubelet evicts by QoS |
| Signal | Container killed and restarted in place | Pod **evicted** and rescheduled elsewhere |
| Victims | Just this container | **BestEffort first, then Burstable** — often innocent Pods |
| Fix | Raise the limit **or** fix the leak | Set requests properly; add capacity; stop oversubscribing |

**Root-cause checklist:**

1. **Limit genuinely too low** — measured usage exceeds the configured limit. Check `container_memory_working_set_bytes` against the limit over time.
2. **A real leak** — memory grows monotonically until the limit, restarts, repeats. In .NET: undisposed `HttpClient`/streams, an ever-growing static cache or `ConcurrentDictionary`, event handlers never unsubscribed, `IMemoryCache` with no size limit or eviction policy.
3. **A spike, not a leak** — a large file, a huge JSON payload, an unbounded query result. Usage is flat then jumps. Stream instead of buffering; page the query; bound the batch.
4. **A runtime that doesn't see the limit.** This is the .NET-specific answer and it is worth knowing precisely: **.NET Core 3.0+ is container-aware and reads cgroup limits**, sizing the GC heap accordingly — but **Server GC** on a many-core node still allocates per-core heaps and can be surprisingly hungry in a small container. In a memory-constrained sidecar or a modest API, `DOTNET_gcServer=0` (workstation GC) or `DOTNET_GCHeapHardLimit` / `GCHeapHardLimitPercent` is the lever. Very old images or a JVM without `-XX:+UseContainerSupport` are the classic "the process never knew it was limited" case.

**Investigation on .NET, concretely:** `dotnet-counters monitor --process-id 1` for `gc-heap-size`, `gen-2-gc-count`, `alloc-rate`; `dotnet-gcdump collect` or `dotnet-dump collect` (needs `SYS_PTRACE`) analysed in Visual Studio or `dotnet-dump analyze` with `dumpheap -stat` to find the retained objects. Ship the dump to S3 from an ephemeral debug container rather than trying to analyse it in the Pod.

**Prevention:** memory request == limit (Guaranteed QoS); a bounded cache with an eviction policy; stream large payloads; alert on **working set > 80 % of limit** *before* the kill; and treat repeated OOMKills as a bug to fix, not a limit to keep raising.

---

## Q22. What is CrashLoopBackOff?

**`CrashLoopBackOff` is a status, not a cause.** It means the container keeps starting and exiting, and the kubelet is applying an **exponential back-off** before each restart — 10 s, 20 s, 40 s, up to a **5-minute cap**, reset after the container runs successfully for 10 minutes. The back-off exists to protect the node and the API server from a tight crash loop.

**The diagnostic sequence, in order:**

```bash
kubectl describe pod <pod>                    # Last State, Reason, Exit Code, Events
kubectl logs <pod> --previous                 # ← the crashed instance's logs. THE key command.
kubectl logs <pod> -c <container> --previous  # multi-container
kubectl get events --sort-by=.lastTimestamp -n <ns>
```
`--previous` is the single most useful flag here: the current container may have only just started, so its logs are empty; the *previous* one contains the stack trace.

**Exit codes are the fastest triage:**

| Exit code | Meaning | Usual cause |
|---|---|---|
| **0** | Exited successfully | The process isn't a long-running server (wrong entrypoint / a script that finishes) |
| **1** | Generic application error | Unhandled exception at startup — read the logs |
| **125/126/127** | Container/command failure | Bad image entrypoint; **`exec format error`** = wrong architecture (an amd64 image on Graviton/arm64) |
| **137** | SIGKILL | **OOMKilled** (Q21), or a liveness probe killing it |
| **139** | SIGSEGV | Native crash |
| **143** | SIGTERM | Terminated gracefully — often a probe or an eviction, not a bug |

**The common causes, ranked by how often they are actually it:**

1. **Application startup exception** — a missing or malformed connection string, an unreachable dependency at boot, a failed migration, an absent environment variable. Logs show it immediately.
2. **Configuration/secret missing** — the Pod won't even reach `Running` if a referenced ConfigMap/Secret key doesn't exist (`CreateContainerConfigError`).
3. **`OOMKilled`** — exit 137 with `Reason: OOMKilled`.
4. **Liveness probe misconfigured** — probing the wrong port or path, or a startup budget shorter than actual startup time, so the kubelet kills the app *while it is starting*, forever. This is the case that looks like an application crash and is not: **add a startup probe** (Q17).
5. **Wrong image or architecture** — `exec format error` on arm64 nodes is extremely common when a CI pipeline builds amd64-only images.
6. **Read-only filesystem or permission denied** — a hardened `securityContext` (`readOnlyRootFilesystem: true`, non-root UID) against an app that writes to disk. Mount an `emptyDir` at the write path.
7. **Dependency not ready at boot** — the app exits instead of retrying. Fix in the app (retry with backoff) or with an init container that waits.

**Investigating when logs are empty:** `kubectl debug pod/<pod> -it --image=busybox --target=<container>` attaches an **ephemeral debug container** sharing the process namespace — the correct way to inspect a distroless or crashlooping container without editing the workload. Alternatively `kubectl debug` a copy with the command overridden to `sleep 3600` so you can exec in and run the entrypoint by hand.

**Prevention:** fail fast with a *clear* message on missing configuration; validate configuration at startup; make dependency connections retry rather than exit; keep startup probes generous; build multi-arch images; and check exit code + `--previous` logs before touching anything.

---

## Q23. How do you troubleshoot a failing Pod?

A deterministic sequence. The discipline is to **follow the Pod's lifecycle** — scheduling → image pull → start → run — because the phase tells you which subsystem to look at.

**Step 1 — What phase is it stuck in?**

```bash
kubectl get pod <pod> -o wide          # STATUS, RESTARTS, NODE, IP
kubectl describe pod <pod>             # Events at the bottom are the answer ~70% of the time
```

**Step 2 — Match the status to the subsystem:**

| Status | Layer | Usual cause | Check |
|---|---|---|---|
| **`Pending`** | **Scheduler** | No node satisfies the request | `kubectl describe pod` → `FailedScheduling`: *"Insufficient cpu/memory"*, taint not tolerated, node affinity unsatisfiable, no PV available, **no free IPs in the subnet** (EKS VPC CNI — Q4 of Module 9) |
| **`ImagePullBackOff` / `ErrImagePull`** | **Registry** | Wrong tag, private registry without `imagePullSecrets`, no ECR permission on the node/pod role, no network route to the registry (missing ECR VPC endpoint or NAT) | `describe` events; `aws ecr describe-images` |
| **`CreateContainerConfigError`** | **kubelet** | Referenced ConfigMap/Secret **key** doesn't exist | `kubectl get cm/secret -o yaml` |
| **`CrashLoopBackOff`** | **Application** | See Q22 | `kubectl logs --previous`, exit code |
| **`Running` but not `Ready`** | **Readiness probe** | Probe failing — wrong port/path, dependency down, app genuinely not ready | `describe` → probe failure events; curl the endpoint from inside |
| **`Terminating` forever** | **Finalizers / graceful shutdown** | A finalizer never removed, or the app ignoring SIGTERM past the grace period | `kubectl get pod -o yaml \| grep finalizers` |
| **`Evicted`** | **Node pressure** | Memory/disk pressure; BestEffort evicted first | `kubectl describe node`, `Conditions` |
| **`OOMKilled`** | **Kernel** | See Q21 | Exit 137 |

**Step 3 — Logs, correctly.**
```bash
kubectl logs <pod> --previous              # the crashed instance — do this first
kubectl logs <pod> -f --tail=100
kubectl logs -l app=payments --all-containers --max-log-requests=10   # across replicas
```

**Step 4 — Get inside.**
```bash
kubectl exec -it <pod> -- /bin/sh
# For distroless / crashlooping containers — the modern, correct tool:
kubectl debug -it <pod> --image=nicolaka/netshoot --target=<container>
kubectl debug node/<node> -it --image=busybox    # node-level investigation
```

**Step 5 — The node, if several Pods on one node misbehave.**
```bash
kubectl describe node <node>   # Conditions: MemoryPressure, DiskPressure, PIDPressure, Ready
kubectl top node ; kubectl top pod
kubectl get pods -A -o wide --field-selector spec.nodeName=<node>
```

**Step 6 — .NET-specific depth**, once you know it's the application:
```bash
dotnet-counters monitor -p 1                    # GC, thread pool, exceptions, request rate
dotnet-stack report -p 1                        # a hang: what are the threads doing?
dotnet-gcdump collect -p 1                      # a leak: what is retained?
```
Thread-pool starvation shows as a rising `ThreadPool Queue Length` with low CPU — usually sync-over-async (`.Result`/`.Wait()`) somewhere in the request path (Module 3).

**The habit that separates seniors:** read the **Events** before the logs, and check whether *this Pod* is broken or *every Pod* is broken. One Pod failing is usually the Pod or its node; all Pods failing at once is a dependency, a config change, or a deploy — and the fastest fix is `kubectl rollout undo`, then investigate.

---

## Q24. How do you troubleshoot a Service?

The Service abstraction has exactly four places to break, and checking them in order resolves it quickly: **selector → endpoints → readiness → ports**.

**Step 1 — Does the Service have endpoints?** This one command answers most Service problems.

```bash
kubectl get endpointslices -l kubernetes.io/service-name=payments
kubectl get endpoints payments        # older but concise
```

**No endpoints** means one of three things:

| Cause | Check |
|---|---|
| **Selector doesn't match the Pod labels** — the most common cause by far | `kubectl get svc payments -o jsonpath='{.spec.selector}'` vs `kubectl get pods --show-labels` |
| **No Pod is `Ready`** — readiness probe failing, so the EndpointSlice controller excluded them | `kubectl get pods -l app=payments` → READY column |
| **Wrong namespace** | Service and Pods must be in the same namespace |

**Step 2 — Is the port mapping right?** `targetPort` must match the container's **actual listening port**, and for ASP.NET Core in a container that means the app must listen on `0.0.0.0`, not `localhost`:
```bash
kubectl get svc payments -o yaml | grep -A3 ports
kubectl exec <pod> -- ss -lntp          # is anything listening, and on which address?
```
`ASPNETCORE_URLS=http://+:8080` (or `http://0.0.0.0:8080`) — binding to `localhost` inside a container is a classic "endpoints exist but nothing connects" failure.

**Step 3 — Test from inside the cluster, at each layer, to isolate the break:**
```bash
kubectl run tmp --rm -it --image=nicolaka/netshoot -- bash
  nslookup payments.prod.svc.cluster.local     # DNS resolving?
  curl -v http://payments.prod:80/health       # Service VIP reachable?
  curl -v http://10.0.3.14:8080/health         # Pod IP directly — bypasses the Service
```
- Pod IP works but Service VIP doesn't → **kube-proxy / EndpointSlice** problem.
- DNS fails → **CoreDNS** problem (`kubectl -n kube-system logs -l k8s-app=kube-dns`, check CoreDNS Pod health and whether it's being throttled or OOMKilled — a very common cluster-wide cause of "random" failures).
- Neither works → **NetworkPolicy** (Q26) or the app isn't listening.

**Step 4 — External exposure (LoadBalancer/Ingress):**
```bash
kubectl describe ingress payments      # controller events, ALB provisioning errors
kubectl -n kube-system logs -l app.kubernetes.io/name=aws-load-balancer-controller
```
On EKS the usual culprits are: missing subnet tags (`kubernetes.io/role/elb` = 1 for public, `internal-elb` for private), the controller's IRSA role lacking permissions, security groups not allowing the load balancer → Pod path, or an unhealthy target group because the ALB health check path differs from the readiness path.

**The one-line triage to remember:** *no endpoints = labels or readiness; endpoints but no connection = ports, NetworkPolicy, or the app binding to localhost.*

---

## Q25. How do you troubleshoot networking?

Work **outward from the Pod**, testing one layer at a time, and use a tool with the utilities in it (`nicolaka/netshoot`) rather than hoping the app image has `curl`.

**The layers, in order:**

| # | Layer | Test | Common failure |
|---|---|---|---|
| 1 | **Container binding** | `kubectl exec <pod> -- ss -lntp` | App bound to `127.0.0.1` instead of `0.0.0.0` |
| 2 | **Pod-to-Pod** | `curl <podIP>:<port>` from a netshoot Pod | **NetworkPolicy** denying; CNI issue |
| 3 | **DNS** | `nslookup <svc>.<ns>.svc.cluster.local`; `cat /etc/resolv.conf` | CoreDNS down/throttled; `ndots:5` causing 4 extra lookups per external name — a real latency source; wrong `dnsPolicy` |
| 4 | **Service VIP** | `curl <svc>:<port>` | No endpoints (Q24); kube-proxy not programming rules |
| 5 | **Ingress / LB** | `curl` the external hostname; check target-group health | Subnet tags, security groups, health-check path mismatch |
| 6 | **Egress to AWS/internet** | `curl https://sts.amazonaws.com` from a Pod | No NAT route, missing VPC endpoint, Network Firewall blocking the domain, no public IP |
| 7 | **Node/VPC** | Security groups, NACLs, route tables, **VPC Reachability Analyzer** | See Module 9 Q18 |

**Kubernetes-specific causes worth naming:**

- **NetworkPolicy default-deny with no matching allow.** The commonest cause of "it worked yesterday" after a security rollout — and note that a policy **has no effect unless the CNI enforces it** (Q26), so it can also be the opposite: everyone believes traffic is restricted and it is not.
- **CoreDNS capacity.** DNS is the single most common cluster-wide "everything is slow" cause. Check CoreDNS replica count, CPU throttling and OOMKills; consider **NodeLocal DNSCache** for high-QPS clusters.
- **`ndots: 5`.** By default a lookup for `api.stripe.com` tries five search-domain permutations first. On a chatty service that is a measurable latency and DNS-load problem; fix with a trailing dot or a tuned `dnsConfig`.
- **VPC CNI IP exhaustion (EKS).** `failed to assign an IP address to container` — the subnet is out of IPs, or the instance type's ENI/IP limit is reached. Fixes: larger subnets, secondary CIDRs with custom networking, or **prefix delegation**.
- **kube-proxy vs eBPF.** At large scale, iptables rule evaluation becomes a real cost; IPVS or an eBPF dataplane (Cilium) is the answer.
- **MTU mismatches** with overlay CNIs — symptom is small requests working and large ones hanging.

**The tooling to name:** `netshoot` (curl, dig, tcpdump, ss, mtr, iperf), **VPC Flow Logs** for the AWS layer, **VPC Reachability Analyzer** for deterministic path analysis, and — if the cluster runs Cilium — **Hubble**, which gives per-flow visibility including *which NetworkPolicy dropped a packet*, which converts this whole exercise from inference to observation.

---

## Q26. What are Network Policies?

**Per the documentation:** *"If you want to control traffic flow at the IP address or port level (OSI layer 3 or 4), NetworkPolicies allow you to specify rules for traffic flow within your cluster, and also between Pods and the outside world."* They are described as an **application-centric construct** — you express intent in terms of labels, not IPs.

**The default, and why this matters:** *by default Kubernetes Pods are **non-isolated** — all inbound and all outbound connections are allowed.* Any Pod can reach any other Pod in any namespace. In a regulated environment that is an audit finding on its own.

**How isolation works:** a Pod becomes isolated for **ingress** as soon as *any* NetworkPolicy selects it with `Ingress` in `policyTypes`; from then on **only** explicitly allowed connections (plus connections from the Pod's own node) are permitted. Same for **egress**. Policies are **additive** — they never conflict; the effective permission is the union. And for a connection between two Pods to succeed, **both** must allow it: the source's egress rules and the destination's ingress rules.

**Selectors available:** `podSelector` (labels, within the policy's namespace), `namespaceSelector` (labels on namespaces), and `ipBlock` (CIDR with optional `except`) — plus port/protocol.

**The critical caveat, quoted because candidates miss it constantly:** *"Network policies are implemented by the network plugin… Creating a NetworkPolicy resource without a controller that implements it will have no effect."* You need a CNI that enforces them — **Calico, Cilium, Antrea, kube-router**. On **EKS, the default VPC CNI now supports NetworkPolicy** (it must be enabled), but historically people installed Calico for exactly this. A cluster full of NetworkPolicies and a CNI that ignores them is a false sense of security, and it is worth saying you would *verify* enforcement with a test Pod rather than assume it.

**The pattern to deploy — default deny, then allow:**

```yaml
# 1. Default deny everything in the namespace (ingress + egress)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny-all, namespace: prod }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
# 2. Allow only what the payments API needs
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: payments-api, namespace: prod }
spec:
  podSelector: { matchLabels: { app: payments-api } }
  policyTypes: [Ingress, Egress]
  ingress:
    - from: [{ podSelector: { matchLabels: { app: ingress-nginx } } }]
      ports: [{ protocol: TCP, port: 8080 }]
  egress:
    - to: [{ podSelector: { matchLabels: { app: ledger } } }]
      ports: [{ protocol: TCP, port: 8080 }]
    - to: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } },
             podSelector: { matchLabels: { k8s-app: kube-dns } } }]
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]   # ALWAYS allow DNS
    - to: [{ ipBlock: { cidr: 10.0.0.0/16 } }]                            # Aurora, in-VPC
      ports: [{ protocol: TCP, port: 5432 }]
```

**Forgetting the DNS egress rule breaks everything** the moment you apply default-deny, and it is the single most common self-inflicted outage when adopting NetworkPolicies. Roll them out namespace by namespace, in a non-production cluster first, with observability (Hubble or Calico flow logs) to see what you are about to break.

**Limits, and what covers them:** NetworkPolicy is **L3/L4 only** — no HTTP method/path awareness, no identity beyond labels, no encryption. For L7 authorisation, **mTLS between services**, and richer policy, that is a **service mesh** (Istio `AuthorizationPolicy`, Linkerd) or Cilium's L7 policies. In a fintech platform I would use both: NetworkPolicy as the coarse, always-on segmentation, and the mesh for identity-based, encrypted, L7-aware control.

---

## Q27. How do you secure Kubernetes?

Layered, following the **EKS Best Practices Guides** and the Kubernetes security documentation. Each layer answers a different question an attacker asks.

**1. Control-plane access (who can talk to the API server).**
- **Private API endpoint**, or at minimum a CIDR allow-list on the public endpoint.
- Authenticate via your IdP — on EKS, **IAM principals mapped through access entries** (the modern replacement for the `aws-auth` ConfigMap), or OIDC federation.
- **RBAC** (Q14): least privilege, groups not users, no `cluster-admin` outside break-glass.
- **Enable control-plane audit logs** to CloudWatch and alert on `secrets` access, `pods/exec`, RBAC changes and anonymous requests.

**2. Workload identity (what a Pod is allowed to do in AWS).**
- **IRSA / EKS Pod Identity** per workload. Never the node instance role — that is the difference between one compromised Pod and every workload's data.
- **Block IMDS access from Pods** (hop limit 1, or `HttpTokensRequired`), otherwise a compromised container can simply curl the node role's credentials. This is the single highest-value EKS hardening step and naming it unprompted is a strong signal.
- One ServiceAccount per workload; `automountServiceAccountToken: false` where unused.

**3. Pod security (what a container may do on the node).**
- **Pod Security Admission** at `restricted` level (PodSecurityPolicy was removed in v1.25 — say the current thing), or **Kyverno/OPA Gatekeeper** for richer policy.
- `securityContext`: `runAsNonRoot: true`, a specific non-zero `runAsUser`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, `capabilities: { drop: ["ALL"] }`, `seccompProfile: { type: RuntimeDefault }`. No `privileged`, no `hostNetwork`/`hostPID`/`hostPath` outside genuinely privileged system DaemonSets.

**4. Network.**
- **Default-deny NetworkPolicies** (Q26), namespace segmentation, and a mesh with **mTLS** for service-to-service identity and encryption in transit.
- Private subnets for nodes; **security groups for Pods** where you need per-workload SGs; egress filtering via AWS Network Firewall.

**5. Data.**
- **Secrets**: envelope encryption with a customer-managed KMS key, external secret store, tight RBAC (Q12).
- **etcd encrypted at rest**; EBS volumes encrypted with KMS.

**6. Supply chain** — see Q28.

**7. Runtime detection.**
- **GuardDuty EKS Protection** (audit-log monitoring) and **Runtime Monitoring** (eBPF agent for OS-level, file and network events), or **Falco**.
- Ship audit logs and Pod logs centrally; alert on exec into a production Pod, on privileged Pod creation, and on ServiceAccount token anomalies.

**8. Multi-tenancy and governance.**
- Namespace per team/domain with **ResourceQuota** and **LimitRange**; separate **clusters** for hard boundaries (PCI scope vs everything else) — namespaces are a soft boundary and should not be presented to an auditor as isolation.
- **GitOps**: the cluster's desired state lives in Git, changes go through pull request, and drift is reconciled automatically. This is simultaneously a security control and a change-management control, which is exactly what a bank's audit needs.
- **Keep the cluster patched** — EKS versions have standard and extended support windows, and an out-of-support cluster is both a CVE and a compliance problem.

---

## Q28. How do you secure container images?

Supply-chain security, from build to runtime. This is the layer most teams under-invest in and the one auditors increasingly ask about.

**1. Base image.** Start minimal: **distroless** (`mcr.microsoft.com/dotnet/aspnet:9.0-noble-chiseled` for .NET — no shell, no package manager, tiny attack surface), Alpine, or a hardened UBI. Pin by **digest**, not tag — `@sha256:...` is immutable; `:latest` is a supply-chain vulnerability that also destroys reproducibility. Rebuild regularly so base-image CVE fixes actually land.

**2. Build.**
- **Multi-stage builds** so the SDK, source and build secrets never reach the runtime image.
- **Never** `ARG`/`ENV` a secret — it is baked into a layer and recoverable from the image.
- `USER app` (non-root) in the Dockerfile; the official .NET images ship a non-root `app` user.
- `.dockerignore` to keep `.git`, `appsettings.Development.json` and credentials out of the context.
- **Reproducible, pinned dependencies** (`packages.lock.json` with `--locked-mode` restore).

**3. Scan — at more than one point.**
| Stage | Tool |
|---|---|
| CI (fail the build) | Trivy, Grype, Snyk, `dotnet list package --vulnerable --include-transitive` |
| Registry (continuous) | **ECR enhanced scanning** (Amazon Inspector) — rescans existing images as new CVEs are published |
| Admission | Block images with critical CVEs, or unsigned images |
| Runtime | GuardDuty Runtime Monitoring / Falco |
The registry-side continuous rescan is the one people forget: an image that was clean at build time is not clean forever.

**4. Sign and verify provenance.**
- **Sigstore/Cosign** signatures, **SLSA** provenance attestations, and an **SBOM** (CycloneDX/SPDX) generated at build and stored with the image.
- Enforce at admission with **Kyverno** (`verifyImages`) or Ratify — so only images built by your pipeline, from your repo, can run. Without an enforcement point, signing is decoration.

**5. Registry controls.** Private **ECR** with immutable tags enabled, repository policies restricting push to CI only, KMS encryption, lifecycle policies to expire old images, and **pull-through cache** rules so you aren't pulling from Docker Hub in production (rate limits *and* a trust boundary).

**6. Admission-time enforcement**, which is what turns all of the above from policy into control:
```yaml
# Kyverno: only signed images from our own registry may run
- name: verify-signature
  match: { any: [{ resources: { kinds: [Pod] } }] }
  verifyImages:
    - imageReferences: ["111122223333.dkr.ecr.eu-west-1.amazonaws.com/*"]
      attestors: [{ entries: [{ keyless: { subject: "https://github.com/org/repo/*",
                                           issuer: "https://token.actions.githubusercontent.com" } }] }]
```
Plus policies for: no `:latest`, no images from unapproved registries, no `privileged`, no `runAsRoot`.

**7. Runtime immutability.** `readOnlyRootFilesystem: true` with `emptyDir` mounts for the few writable paths; drop all capabilities; `RuntimeDefault` seccomp. An immutable container is one an attacker cannot easily persist in.

**The framing for a panel:** the image is a **supply chain**, and every link needs provenance — where the base came from, what was added, who built it, what it contains (SBOM), and proof it wasn't altered (signature) — with an **enforcement point at admission**, because a policy nothing enforces is a document, not a control.

---

## Q29. How do you deploy .NET microservices to EKS?

End to end, as I would actually build it.

**1. The image.** Multi-stage, chiselled, non-root, multi-arch:

```dockerfile
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:9.0 AS build
ARG TARGETARCH
WORKDIR /src
COPY ["Payments.Api/Payments.Api.csproj", "Payments.Api/"]
RUN dotnet restore "Payments.Api/Payments.Api.csproj" -a $TARGETARCH   # layer-cached
COPY . .
RUN dotnet publish "Payments.Api/Payments.Api.csproj" -c Release -a $TARGETARCH \
    --no-restore -o /app

FROM mcr.microsoft.com/dotnet/aspnet:9.0-noble-chiseled AS final
WORKDIR /app
COPY --from=build /app .
USER $APP_UID                       # non-root, provided by the base image
ENV ASPNETCORE_URLS=http://+:8080   # bind 0.0.0.0, NOT localhost
EXPOSE 8080
ENTRYPOINT ["dotnet", "Payments.Api.dll"]
```
Build **arm64** for Graviton nodes (typically 20–40 % better price/performance for ASP.NET Core) — and build multi-arch, because an amd64-only image on a Graviton node is `exec format error` (Q22).

**2. Application readiness for Kubernetes** — the part that is code, not YAML:

```csharp
builder.Services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])
    .AddNpgSql(cs, name: "ledger", tags: ["ready"]);

builder.Services.Configure<HostOptions>(o =>
    o.ShutdownTimeout = TimeSpan.FromSeconds(45));      // must be < terminationGracePeriodSeconds

// Behind an ALB/ingress: honour forwarded headers so scheme/client IP are correct
builder.Services.Configure<ForwardedHeadersOptions>(o =>
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto);

var app = builder.Build();
app.MapHealthChecks("/health/live",  new() { Predicate = c => c.Tags.Contains("live")  });
app.MapHealthChecks("/health/ready", new() { Predicate = c => c.Tags.Contains("ready") });
```
Also: **structured logging to stdout** (Serilog JSON — never log to files in a container), **OpenTelemetry** for traces/metrics with the ADOT collector, graceful SIGTERM handling via `IHostApplicationLifetime`, and configuration from environment variables using the `__` hierarchy separator.

**3. AWS identity — IRSA, so there are no credentials anywhere:**
```bash
eksctl create iamserviceaccount --name payments-api --namespace prod \
  --cluster prod-eks --attach-policy-arn arn:aws:iam::…:policy/payments-api \
  --approve
```
`new AmazonSQSClient()` then just works, with temporary, per-Pod credentials.

**4. The manifests** (Helm chart or Kustomize base + overlays):
```yaml
spec:
  replicas: 3
  strategy: { rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } }
  template:
    spec:
      serviceAccountName: payments-api
      securityContext: { runAsNonRoot: true, seccompProfile: { type: RuntimeDefault } }
      topologySpreadConstraints:
        - { maxSkew: 1, topologyKey: topology.kubernetes.io/zone,
            whenUnsatisfiable: DoNotSchedule, labelSelector: { matchLabels: { app: payments-api } } }
      terminationGracePeriodSeconds: 60
      containers:
        - name: api
          image: 111122223333.dkr.ecr.eu-west-1.amazonaws.com/payments-api@sha256:…
          ports: [{ containerPort: 8080 }]
          resources:
            requests: { cpu: "500m", memory: "512Mi" }
            limits:   { memory: "512Mi" }          # memory req == limit; no CPU limit (Q20)
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          startupProbe:   { httpGet: { path: /health/live,  port: 8080 }, failureThreshold: 30, periodSeconds: 5 }
          readinessProbe: { httpGet: { path: /health/ready, port: 8080 }, periodSeconds: 5 }
          livenessProbe:  { httpGet: { path: /health/live,  port: 8080 }, periodSeconds: 10, failureThreshold: 3 }
          env:
            - name: ASPNETCORE_ENVIRONMENT
              value: Production
          volumeMounts: [{ name: tmp, mountPath: /tmp }]
      volumes: [{ name: tmp, emptyDir: {} }]
```
Plus a **PodDisruptionBudget** (`minAvailable: 2`), a ClusterIP **Service**, an **Ingress** (ALB with ACM cert and WAF), an **HPA**, and **NetworkPolicies**.

**5. Cluster components:** AWS Load Balancer Controller, **Karpenter** for node provisioning, EBS/EFS CSI drivers, ExternalDNS, cert-manager, **Secrets Store CSI Driver**, metrics-server, ADOT collector or Prometheus, and a CNI configured with **prefix delegation** so you don't exhaust subnet IPs.

**6. Delivery.** GitHub Actions (OIDC to AWS — **no stored keys**) builds, scans, signs and pushes; **Argo CD** syncs the manifests from Git; **Argo Rollouts** or Flagger runs a canary keyed on real metrics (error rate, p99) with automatic rollback. Environments are Kustomize overlays, promoted by a pull request — which is also your audit trail.

**7. The .NET-specific pitfalls to name** — this is where the question is really testing experience:
- **Bind to `0.0.0.0`**, not `localhost` (Q24).
- **`terminationGracePeriodSeconds` must exceed the app's shutdown timeout**, and the shutdown sequence must be: fail readiness → wait for the endpoint to be removed (a few seconds) → drain in-flight requests → exit. Otherwise every deploy drops requests.
- **Thread-pool starvation** from sync-over-async is the top .NET-on-Kubernetes latency bug, and it presents as high latency at *low* CPU, so HPA-on-CPU never reacts.
- **Server GC in a small container** — check whether workstation GC or a heap hard limit is more appropriate (Q21).
- **`HttpClient` via `IHttpClientFactory`** with Polly for retry/circuit-breaking; a raw `new HttpClient()` per request exhausts sockets, and a static one misses DNS changes when a Service's endpoints move.

---

## Q30. How would you design production Kubernetes architecture?

The full design, in the order I would actually decide it — for a regulated payments platform on EKS.

**1. Cluster topology and boundaries.**
- **Separate clusters per environment** (dev / test / prod), and a **separate cluster for the PCI-scoped workloads**. Namespaces are a soft boundary; when an auditor asks what prevents lateral movement, a cluster boundary is a much better answer.
- **One account per cluster** (Module 9 Q46), private API endpoint, multi-AZ across **three** AZs.
- Regional, not multi-region, unless RTO/RPO demands it — with the DR strategy expressed as **GitOps re-deployment into a standby cluster**, since manifests in Git make cluster rebuild fast and provable.

**2. Nodes.**
- **Karpenter** rather than fixed node groups — it provisions right-sized nodes from pending-pod requirements in about a minute and consolidates them afterwards.
- **Graviton (arm64)** for the .NET workloads; **Spot for stateless/batch** with a diversified instance pool and interruption handling; **On-Demand for anything stateful or latency-critical**.
- Separate **node pools** by workload class (system add-ons, general apps, memory-heavy, PCI-scoped) using taints/tolerations, so a noisy batch job cannot land next to the payment path.
- Bottlerocket or a hardened AMI; nodes replaced, never patched in place.

**3. Networking.**
- VPC CNI with **prefix delegation**, subnets sized for pod density (Module 9 Q4).
- **ALB via Ingress** for HTTP; NLB only where a static IP or non-HTTP protocol demands it.
- **Default-deny NetworkPolicies** everywhere; a service mesh (Istio ambient or Linkerd) for **mTLS**, L7 authorization, retries/timeouts and traffic shifting — adopted deliberately, because a mesh is a real operational commitment.
- **Gateway API** as the forward-looking ingress model.

**4. Workload standards** — enforced, not documented:
- Every Deployment: 3+ replicas, `topologySpreadConstraints` across AZs, PDB, `maxUnavailable: 0`, all three probes, requests set, memory request == limit, `restricted` Pod Security, non-root, read-only rootfs.
- Enforced at admission by **Kyverno**, so a non-compliant manifest cannot be applied. A standard without an enforcement point is a wish.

**5. Identity and secrets.** IRSA/Pod Identity per workload; IMDS blocked from Pods; Secrets Store CSI Driver reading from Secrets Manager; envelope encryption on etcd with a customer-managed KMS key; RBAC bound to IdP groups; no standing human write access to production.

**6. Observability.** OpenTelemetry throughout → ADOT collector → CloudWatch/Prometheus/Grafana for metrics, CloudWatch Logs or OpenSearch for logs, X-Ray or Tempo/Jaeger for traces; **correlation ID propagated end to end**; **SLOs with burn-rate alerts** rather than CPU alarms; control-plane audit logs to CloudWatch with alerts on exec, secrets access and RBAC changes; **Container Insights** and **kube-state-metrics** for cluster-level signals; cost visibility with Kubecost/OpenCost.

**7. Delivery.** GitOps with **Argo CD** — Git is the source of truth, drift is reconciled, every change is a reviewed pull request (separation of duties, and an audit trail regulators accept). Progressive delivery with **Argo Rollouts** canaries gated on real metrics. Cluster upgrades on a scheduled cadence with blue/green node pools, tested first in non-prod.

**8. Resilience and its verification.** PDBs, multi-AZ spread, graceful shutdown, retries with **jitter** and circuit breakers (Polly or the mesh), backpressure on queue consumers. Then **prove it**: chaos experiments (AWS FIS, Litmus) that kill Pods, drain nodes and remove an AZ, run as scheduled game days. An untested resilience design is a hypothesis.

**9. What I would deliberately *not* do:**
- Not run the primary database as a StatefulSet — Aurora is the better answer (Q5).
- Not adopt a service mesh on day one — start with NetworkPolicies and add the mesh when mTLS or L7 policy is genuinely required.
- Not build a bespoke platform where EKS add-ons, **EKS Auto Mode** or **EKS Capabilities** (managed Argo CD, ACK, kro) already cover it. Every component you install is one you own at 3 a.m.
- Not use Kubernetes at all for a small estate — if the answer is eight stateless services and a database, **ECS on Fargate** is less to operate and is a legitimate, defensible recommendation (Module 9 Q28).

**The closing framing:** Kubernetes gives you primitives, not a platform. The architecture work is deciding **which primitives you standardise on, how they are enforced, and who operates them** — because in production the differentiator is not whether the cluster runs, but whether a deploy is boring, a node failure is invisible, and an incident is diagnosable in minutes.

---

## References — official documentation

| Topic | Source |
|---|---|
| Kubernetes documentation (home) | https://kubernetes.io/docs/home/ |
| What is Kubernetes / Overview | https://kubernetes.io/docs/concepts/overview/ |
| Cluster components | https://kubernetes.io/docs/concepts/overview/components/ |
| Pods | https://kubernetes.io/docs/concepts/workloads/pods/ |
| Pod lifecycle | https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/ |
| Sidecar containers | https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/ |
| Deployments | https://kubernetes.io/docs/concepts/workloads/controllers/deployment/ |
| StatefulSets | https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/ |
| DaemonSet / Job / CronJob | https://kubernetes.io/docs/concepts/workloads/controllers/ |
| Pod Disruption Budgets | https://kubernetes.io/docs/concepts/workloads/pods/disruptions/ |
| Pod topology spread constraints | https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/ |
| Service | https://kubernetes.io/docs/concepts/services-networking/service/ |
| Ingress | https://kubernetes.io/docs/concepts/services-networking/ingress/ |
| Ingress controllers | https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/ |
| Gateway API | https://kubernetes.io/docs/concepts/services-networking/gateway/ |
| DNS for Services and Pods | https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/ |
| Network Policies | https://kubernetes.io/docs/concepts/services-networking/network-policies/ |
| ConfigMaps | https://kubernetes.io/docs/concepts/configuration/configmap/ |
| Secrets | https://kubernetes.io/docs/concepts/configuration/secret/ |
| Good practices for Kubernetes Secrets | https://kubernetes.io/docs/concepts/security/secrets-good-practices/ |
| Encrypting confidential data at rest | https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/ |
| Liveness, readiness and startup probes | https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/ |
| Configure probes (task) | https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/ |
| Resource management for Pods and containers | https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/ |
| Quality of Service classes | https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/ |
| Node-pressure eviction | https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/ |
| Horizontal Pod Autoscaling | https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/ |
| HPA walkthrough | https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/ |
| ServiceAccounts | https://kubernetes.io/docs/concepts/security/service-accounts/ |
| RBAC authorization | https://kubernetes.io/docs/reference/access-authn-authz/rbac/ |
| Pod Security Admission | https://kubernetes.io/docs/concepts/security/pod-security-admission/ |
| Security context | https://kubernetes.io/docs/tasks/configure-pod-container/security-context/ |
| Debug running Pods (incl. ephemeral containers) | https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/ |
| Debug Services | https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/ |
| Amazon EKS User Guide | https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html |
| EKS Auto Mode | https://docs.aws.amazon.com/eks/latest/userguide/automode.html |
| EKS — IAM roles for service accounts (IRSA) | https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html |
| EKS Pod Identity | https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html |
| EKS — cluster access management (access entries) | https://docs.aws.amazon.com/eks/latest/userguide/grant-k8s-access.html |
| EKS — envelope encryption of secrets with KMS | https://docs.aws.amazon.com/eks/latest/userguide/envelope-encryption.html |
| EKS — VPC CNI and prefix delegation | https://docs.aws.amazon.com/eks/latest/userguide/cni-increase-ip-addresses.html |
| EKS — security best practices | https://docs.aws.amazon.com/eks/latest/userguide/security-best-practices.html |
| EKS Best Practices Guides | https://aws.github.io/aws-eks-best-practices/ |
| AWS Load Balancer Controller | https://kubernetes-sigs.github.io/aws-load-balancer-controller/ |
| Karpenter | https://karpenter.sh/docs/ |
| Secrets Store CSI Driver | https://secrets-store-csi-driver.sigs.k8s.io/ |
| GuardDuty — EKS Protection & Runtime Monitoring | https://docs.aws.amazon.com/guardduty/latest/ug/kubernetes-protection.html |
| Amazon ECR image scanning (Inspector) | https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html |
| Microsoft Learn — .NET container images | https://learn.microsoft.com/en-us/dotnet/core/docker/container-images |
| Microsoft Learn — ASP.NET Core health checks | https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/health-checks |
| Microsoft Learn — .NET and container resource limits (GC) | https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector |

---

**Previous:** [09 — AWS Architecture](./09-AWS-Architecture.md) | **Next:** [11 — Performance Engineering](./11-Performance-Engineering.md)
