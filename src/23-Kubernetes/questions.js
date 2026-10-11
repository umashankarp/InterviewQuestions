(function (r) {
registerTopic('23-kubernetes', {
related: ['24-docker', '39-service-mesh', '26-cicd'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['architecture', 'control-plane', 'reconciliation'],
  q: r`Walk through Kubernetes architecture by tracing what happens from {{kubectl apply}} of a Deployment to containers running on a node. What is the reconciliation loop and why does it matter?`,
  a: r`**Control plane**
- **kube-apiserver**: the only component that talks to etcd. Authenticates, authorises (RBAC), runs **admission** (mutating then validating), validates schemas, persists objects, and serves **watches**.
- **etcd**: a Raft-replicated key-value store holding the desired and observed state of every object.
- **kube-scheduler**: watches unscheduled pods and binds each to a node (filter → score).
- **kube-controller-manager**: runs controllers (Deployment, ReplicaSet, Node, Job, EndpointSlice...).
- **cloud-controller-manager**: cloud integrations (load balancers, node lifecycle, routes).

**Node**: **kubelet** (makes pods on its node match their specs, via the CRI), a **container runtime** (containerd/CRI-O), **kube-proxy** (or an eBPF CNI replacement) for Service routing, and the **CNI** plugin for pod networking.

**The trace**
1. {{kubectl apply}} sends the Deployment to the API server: authn → RBAC → mutating admission → schema validation → validating admission → stored in etcd.
2. The **Deployment controller** (watching Deployments) creates a **ReplicaSet**.
3. The **ReplicaSet controller** creates N **Pod** objects (no node yet).
4. The **scheduler** sees pods with empty {{nodeName}}, filters nodes (resources, taints, affinity, topology), scores them, and writes a **binding**.
5. The **kubelet** on that node sees the pod, asks the CNI for networking, pulls images, starts init containers, then app containers; runs probes; reports status.
6. The **EndpointSlice controller** adds the pod to its Services' endpoints once it is **Ready**; kube-proxy/eBPF programs routing.

**Reconciliation**: every controller runs "observe actual state → compare with desired → act → repeat". Nothing is a one-shot command; Kubernetes is **level-triggered**: if a pod dies or a node disappears, the controller notices the gap and fixes it. Consequences interviewers probe:
- Components are loosely coupled through the API server and can restart independently.
- Changes are **eventually** applied — "applied" does not mean "running".
- Manual changes to managed objects get reverted (edit a ReplicaSet owned by a Deployment and it is reconciled back).`,
  code: r`~~~bash
kubectl apply -f deployment.yaml
kubectl rollout status deploy/payments-api -n payments      # waits for the reconciliation to converge
kubectl get rs,pods -n payments -l app=payments-api -o wide  # Deployment -> ReplicaSet -> Pods -> nodes
kubectl get events -n payments --sort-by=.lastTimestamp       # scheduler, kubelet and controller decisions
~~~`,
  dia: r`sequenceDiagram
  participant U as kubectl
  participant A as API server
  participant E as etcd
  participant DC as Deployment controller
  participant RC as ReplicaSet controller
  participant S as Scheduler
  participant K as kubelet
  U->>A: apply Deployment
  A->>A: authn, RBAC, admission, validation
  A->>E: persist
  DC->>A: watch Deployment, create ReplicaSet
  RC->>A: watch ReplicaSet, create Pods
  S->>A: watch unscheduled Pods, bind to node
  K->>A: watch Pods on my node
  K->>K: CNI, pull image, start containers, probes
  K->>A: report status Ready`,
  pts: [r`API server is the hub; only it talks to etcd.`, r`Deployment → ReplicaSet → Pods → scheduler binding → kubelet.`, r`Controllers reconcile desired vs actual state continuously.`, r`Admission (mutating then validating) runs before persistence.`, r`Applied is not running: watch rollout status and events.`],
  ex: r`An engineer scaled a ReplicaSet by hand during an incident; the Deployment controller immediately scaled it back, which is why changes must go through the owning object.`,
  fu: [r`What happens to running pods if the control plane is down?`, r`Why is Kubernetes called level-triggered rather than edge-triggered?`],
  pit: [r`Saying the scheduler starts containers.`, r`Treating kubectl apply success as proof the workload is running.`, r`Editing objects owned by a controller.`] },

{ id: 'q2', level: 'Basic', tags: ['pods', 'sidecars', 'init-containers', 'lifecycle'],
  q: r`Why is the pod, not the container, the unit of scheduling? Explain shared namespaces, init containers, native sidecar containers, restart policies and the pod lifecycle.`,
  a: r`**A pod is a group of containers that share**: a network namespace (one IP, talk over {{localhost}}, shared port space), optionally IPC and PID namespaces, and **volumes**. They are always co-scheduled on the same node and share a lifecycle. This models tightly coupled helpers (proxy, log shipper, config reloader) that must live with the main process.

**Init containers** run **sequentially to completion** before app containers start: wait for a dependency, run a migration check, fetch certificates. If one fails, the kubelet restarts it according to the restart policy; the pod stays in {{Init}}.

**Native sidecar containers** (stable since Kubernetes 1.33): declared as init containers with {{restartPolicy: Always}}. They start **before** app containers, keep running alongside them, and are stopped **after** the app containers on shutdown. This fixes old problems: service-mesh proxies not ready when the app starts, and Jobs that never completed because a sidecar kept running.

**Restart policies**: {{Always}} (Deployments), {{OnFailure}} / {{Never}} (Jobs). Restarts use exponential backoff capped at 5 minutes — that is **CrashLoopBackOff**, a symptom, not a cause.

**Lifecycle**: phases {{Pending}} (accepted, not yet running: scheduling or image pull) → {{Running}} → {{Succeeded}} / {{Failed}}; {{Unknown}} when the node stops reporting. **Conditions** ({{PodScheduled}}, {{Initialized}}, {{ContainersReady}}, {{Ready}}) are more informative than the phase.

**Pods are ephemeral and replaceable**: new pod = new IP and fresh filesystem. Never address pods directly; use Services. Never store state in the container filesystem.

**Design guidance**: one main process per container; sidecars only when the helper genuinely shares lifecycle and network with the app. Many sidecars per pod multiply resource overhead across replicas.`,
  code: r`~~~yaml
apiVersion: v1
kind: Pod
metadata: { name: statements-worker }
spec:
  initContainers:
    - name: wait-for-db                       # runs to completion first
      image: busybox:1.36
      command: ["sh", "-c", "until nc -z ledger-db 5432; do sleep 2; done"]
    - name: log-shipper                       # native sidecar: starts before the app, stops after it
      image: fluent/fluent-bit:3.1
      restartPolicy: Always
      volumeMounts: [ { name: logs, mountPath: /var/log/app } ]
  containers:
    - name: app
      image: acr.example/statements-worker:1.8.2
      volumeMounts: [ { name: logs, mountPath: /var/log/app } ]
  volumes:
    - { name: logs, emptyDir: {} }
~~~`,
  dia: r`flowchart LR
  subgraph POD[Pod - one IP, shared volumes]
    I1[init: wait-for-db] --> SC[sidecar: log-shipper - restartPolicy Always]
    SC --> APP[app container]
    APP -.localhost.-> SC
  end
  SVC[Service] --> POD`,
  pts: [r`Containers in a pod share network, volumes and lifecycle and are co-scheduled.`, r`Init containers run sequentially to completion first.`, r`Native sidecars (init containers with restartPolicy Always) start first and stop last.`, r`CrashLoopBackOff is restart backoff, a symptom.`, r`Pods are ephemeral: use Services and external state.`],
  ex: r`A nightly reconciliation Job never completed because its mesh sidecar kept running; converting the proxy to a native sidecar let the Job finish and release its resources.`,
  fu: [r`When would you share the PID namespace in a pod?`, r`Why not put the app and its database in one pod?`],
  pit: [r`Putting unrelated services in one pod.`, r`Relying on pod IPs.`, r`Treating CrashLoopBackOff as the root cause.`] },

{ id: 'q3', level: 'Basic', tags: ['probes', 'health-checks', 'dotnet'],
  q: r`Liveness, readiness and startup probes: what does each do, how should a .NET service implement them, and how do badly designed probes cause outages?`,
  a: r`| Probe | Question | On failure |
|---|---|---|
| **Startup** | has the app finished starting? | other probes wait; after {{failureThreshold × periodSeconds}} the container is restarted |
| **Liveness** | is the process stuck beyond recovery? | kubelet **restarts the container** |
| **Readiness** | can this pod serve traffic right now? | pod is **removed from Service endpoints**; no restart |

**Implementation in ASP.NET Core** — tag health checks and map separate endpoints:
- {{/health/live}}: only "the process can respond" (no dependency checks). If the thread pool is deadlocked it will fail, which is exactly when a restart helps.
- {{/health/ready}}: checks the app can do useful work — warm-up done, critical **local** prerequisites, perhaps a cheap check of its primary database with a short timeout.
- Startup probe for slow starts (JIT, cache warm-up, migrations check) so liveness does not kill a starting app.

**How probes cause outages**
1. **Liveness checking dependencies**: the database has a 30-second blip → every pod fails liveness → every pod restarts simultaneously → cold caches, connection storms, longer outage. Never put shared dependencies in liveness.
2. **Readiness checking shared dependencies too strictly**: all pods go unready at once → the Service has zero endpoints → hard 503s instead of degraded service. Consider readiness reflecting only local ability, and let the app degrade (cached responses, queued writes).
3. **Timeouts too short** under load (GC pause, CPU throttling) → false failures → restarts that add load → cascading failure.
4. No startup probe with a long-starting app → liveness kills it in a loop.

**Tuning**: {{periodSeconds}}, {{timeoutSeconds}} (default 1 s is aggressive for busy .NET apps), {{failureThreshold}}; probes should be cheap and not allocate heavily or hit the database every second per pod.`,
  code: r`~~~csharp
builder.Services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])
    .AddCheck<WarmupHealthCheck>("warmup", tags: ["ready"])                      // caches primed
    .AddNpgSql(connString, name: "ledger-db", timeout: TimeSpan.FromSeconds(1), tags: ["ready"]);

app.MapHealthChecks("/health/live",  new() { Predicate = r => r.Tags.Contains("live") });
app.MapHealthChecks("/health/ready", new() { Predicate = r => r.Tags.Contains("ready") });
~~~
~~~yaml
startupProbe:   { httpGet: { path: /health/live,  port: 8080 }, periodSeconds: 5,  failureThreshold: 24 }   # up to 120 s to start
livenessProbe:  { httpGet: { path: /health/live,  port: 8080 }, periodSeconds: 10, timeoutSeconds: 3, failureThreshold: 3 }
readinessProbe: { httpGet: { path: /health/ready, port: 8080 }, periodSeconds: 5,  timeoutSeconds: 3, failureThreshold: 2 }
~~~`,
  dia: r`flowchart TD
  S[Container starts] --> SP{Startup probe passes?}
  SP -->|no, threshold exceeded| R[Restart container]
  SP -->|yes| L{Liveness}
  SP -->|yes| RD{Readiness}
  L -->|fails x3| R
  RD -->|fails| OUT[Removed from Service endpoints]
  RD -->|passes| IN[Receives traffic]`,
  pts: [r`Startup protects slow starts; liveness restarts; readiness gates traffic.`, r`Liveness must not check shared dependencies.`, r`Readiness reflects ability to serve; avoid all pods going unready together.`, r`Tune timeouts for GC pauses and throttling; default 1 s is aggressive.`, r`Keep probes cheap.`],
  ex: r`A payments API's liveness probe pinged SQL; a 40-second database failover restarted all 30 pods at once and turned a blip into a 6-minute outage. Moving the DB check to readiness fixed it.`,
  fu: [r`Should readiness fail when the database is down?`, r`How do you warm a .NET app before it receives traffic?`],
  pit: [r`Dependency checks in liveness.`, r`No startup probe for slow-starting apps.`, r`One-second timeouts on busy pods.`] },

{ id: 'q4', level: 'Basic', tags: ['deployments', 'rolling-update', 'rollback'],
  q: r`How does a Deployment rolling update work? Explain ReplicaSets, maxSurge and maxUnavailable, minReadySeconds, rollout history and rollback, and what makes a rollout actually zero-downtime.`,
  a: r`**Mechanics**: each change to the pod template creates a new **ReplicaSet** (identified by a template hash). The Deployment controller scales the new ReplicaSet up and the old one down within limits:
- **maxSurge**: how many pods above {{replicas}} may exist during the rollout (default 25%).
- **maxUnavailable**: how many below {{replicas}} may be unavailable (default 25%).
- For 10 replicas with surge 25% (rounds up → 3) and unavailable 0: up to 13 pods; never fewer than 10 ready.

A new pod counts as available only after it is **Ready** for {{minReadySeconds}} — this catches pods that pass readiness and then crash.

**Rollback**: old ReplicaSets are kept ({{revisionHistoryLimit}}, default 10). {{kubectl rollout undo}} scales an old ReplicaSet back up — fast because images are probably cached. In GitOps, roll back by reverting the commit (otherwise the GitOps controller re-applies the bad version).

**Stuck rollouts**: {{progressDeadlineSeconds}} (default 600) marks the rollout {{Progressing=False}}; Kubernetes does **not** auto-rollback — your pipeline or a progressive delivery tool must.

**Zero downtime requires more than a rolling update**
- Correct **readiness** probes so traffic reaches only warm pods.
- **Graceful shutdown**: handle SIGTERM, drain in-flight requests, and a **preStop delay** to cover endpoint propagation (q17).
- **maxUnavailable: 0** for capacity-sensitive services.
- **Backward-compatible changes**: during the rollout old and new versions run together — APIs, message schemas and database schema must work with both (expand/contract).
- **PodDisruptionBudgets** for node maintenance (separate from rollouts).

**Recreate strategy** (kill all, then start new) exists for apps that cannot run two versions concurrently — accepting downtime.`,
  code: r`~~~yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: payments-api, namespace: payments }
spec:
  replicas: 10
  revisionHistoryLimit: 5
  minReadySeconds: 10
  progressDeadlineSeconds: 300
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxSurge: 25%, maxUnavailable: 0 }   # never below 10 ready pods
  selector: { matchLabels: { app: payments-api } }
  template:
    metadata: { labels: { app: payments-api } }
    spec:
      containers:
        - name: api
          image: registry.example/payments-api@sha256:9c1e...
~~~
~~~bash
kubectl rollout status deploy/payments-api -n payments --timeout=5m || kubectl rollout undo deploy/payments-api -n payments
kubectl rollout history deploy/payments-api -n payments
~~~`,
  dia: r`flowchart LR
  D[Deployment v2 template] --> RS2[ReplicaSet v2: 0 → 10]
  D --> RS1[ReplicaSet v1: 10 → 0]
  RS2 --> P2[New pods - Ready for minReadySeconds]
  RS1 --> P1[Old pods - drained gracefully]
  SVC[Service] --> P1
  SVC --> P2`,
  pts: [r`Each template change creates a ReplicaSet; the controller shifts replicas between them.`, r`maxSurge and maxUnavailable bound capacity during rollout.`, r`minReadySeconds and progressDeadlineSeconds detect bad pods; no automatic rollback.`, r`Rollback via rollout undo or, under GitOps, a Git revert.`, r`Zero downtime also needs readiness, graceful shutdown and backward-compatible changes.`],
  ex: r`A team assumed Kubernetes would roll back a failed release; the rollout stalled at 30% for an hour. Their pipeline now fails on rollout status and triggers an automated undo.`,
  fu: [r`What happens to a rollout if you push a new image mid-rollout?`, r`Why can't Kubernetes roll back database schema changes?`],
  pit: [r`Expecting automatic rollback.`, r`maxUnavailable above zero for capacity-critical services.`, r`Breaking schema changes during rolling updates.`] },

{ id: 'q5', level: 'Basic', tags: ['services', 'kube-proxy', 'endpointslices', 'dns'],
  q: r`Explain Kubernetes Services: ClusterIP, NodePort, LoadBalancer and headless; how kube-proxy (iptables, IPVS, nftables) or eBPF routes traffic; EndpointSlices; and cluster DNS names.`,
  a: r`**A Service is a stable virtual IP and DNS name** in front of a changing set of pods selected by labels.

| Type | What you get |
|---|---|
| **ClusterIP** (default) | virtual IP reachable inside the cluster |
| **NodePort** | ClusterIP + a port (30000-32767) on every node |
| **LoadBalancer** | NodePort/ClusterIP + a cloud load balancer (via cloud controller or LB controller) |
| **Headless** ({{clusterIP: None}}) | no virtual IP; DNS returns pod IPs directly — for StatefulSets and client-side load balancing |
| **ExternalName** | DNS CNAME to an external name |

**EndpointSlices** list the ready pod IPs and ports behind a Service (sharded slices of up to 100 endpoints by default, scaling better than the old Endpoints object). Only **Ready** pods are included (unless {{publishNotReadyAddresses}}).

**Data path**
- **kube-proxy** on every node watches Services and EndpointSlices and programs the kernel: **iptables** (random backend selection via rules; rule count grows with services), **IPVS** (hash tables, more balancing algorithms), or **nftables** (the modern successor, GA in recent releases).
- **eBPF CNIs** (Cilium) can replace kube-proxy entirely with eBPF maps — lower latency at large scale, better observability.
- Traffic to a ClusterIP is DNAT-ed **on the client's node** to a pod IP; there is no proxy process in the path.

**Load-balancing consequence**: balancing is per **connection**, not per request. HTTP/2 and gRPC keep long-lived connections, so all requests from one client pod can stick to one backend — use client-side balancing (headless + gRPC load balancing), a mesh, or connection recycling.

**DNS** (CoreDNS): {{<service>.<namespace>.svc.cluster.local}}; headless StatefulSet pods get {{<pod>.<service>.<namespace>.svc.cluster.local}}. The default {{ndots:5}} causes extra lookups for external names (q31).

**Traffic policies**: {{externalTrafficPolicy: Local}} preserves client source IP and avoids an extra hop (but only nodes with pods receive traffic); {{internalTrafficPolicy: Local}} and topology-aware routing keep traffic in-zone to cut cross-AZ cost.`,
  code: r`~~~yaml
apiVersion: v1
kind: Service
metadata: { name: payments-api, namespace: payments }
spec:
  type: ClusterIP
  selector: { app: payments-api }
  ports: [ { name: http, port: 80, targetPort: 8080 } ]
  trafficDistribution: PreferClose        # prefer same-zone endpoints (cuts cross-AZ traffic)
---
apiVersion: v1
kind: Service
metadata: { name: ledger-grpc, namespace: payments }
spec:
  clusterIP: None                         # headless: DNS returns pod IPs for client-side gRPC balancing
  selector: { app: ledger }
  ports: [ { name: grpc, port: 5001 } ]
~~~
~~~csharp
// gRPC client-side load balancing across pod IPs from the headless Service
var channel = GrpcChannel.ForAddress("dns:///ledger-grpc.payments.svc.cluster.local:5001", new GrpcChannelOptions
{
    Credentials = ChannelCredentials.Insecure,               // mesh or TLS terminates elsewhere in this example
    ServiceConfig = new ServiceConfig { LoadBalancingConfigs = { new RoundRobinConfig() } }
});
~~~`,
  dia: r`flowchart LR
  C[Client pod] -->|payments-api.payments.svc| DNS[CoreDNS]
  C -->|ClusterIP 10.96.12.7:80| KP[kube-proxy rules / eBPF on client node]
  KP -->|DNAT| P1[Pod 10.244.1.5:8080]
  KP --> P2[Pod 10.244.2.9:8080]
  ES[EndpointSlice: ready pod IPs] -.programs.-> KP`,
  pts: [r`A Service is a stable VIP and DNS name over label-selected ready pods.`, r`ClusterIP, NodePort, LoadBalancer, headless and ExternalName serve different needs.`, r`kube-proxy (iptables/IPVS/nftables) or eBPF DNATs on the client node; no proxy hop.`, r`Balancing is per connection: HTTP/2 and gRPC need client-side or mesh balancing.`, r`Use topology-aware routing to reduce cross-zone traffic.`],
  ex: r`A gRPC ledger service had one pod at 90% CPU and four idle because clients held single connections; a headless Service with round-robin client balancing evened the load.`,
  fu: [r`Why does externalTrafficPolicy Local preserve source IPs?`, r`How does a pod becoming unready affect existing connections?`],
  pit: [r`Assuming per-request balancing for gRPC.`, r`Addressing pods by IP.`, r`Ignoring cross-zone data transfer cost.`] },

{ id: 'q6', level: 'Basic', tags: ['configmaps', 'secrets', 'encryption'],
  q: r`ConfigMaps and Secrets: how are they stored and consumed, why is base64 not encryption, how do you protect Secrets properly, and how do config changes reach running .NET pods?`,
  a: r`**ConfigMap**: non-sensitive configuration (feature flags, endpoints, appsettings fragments). **Secret**: sensitive values (passwords, tokens, TLS keys). Both are API objects stored in **etcd**; size limit about 1 MiB each.

**Base64 is encoding, not encryption.** Anyone who can {{get secrets}} in the namespace, read etcd, or read an etcd backup can read every value.

**Protecting Secrets**
1. **Encryption at rest** in etcd via an {{EncryptionConfiguration}} with a **KMS provider** (KMS v2 — envelope encryption with keys in a cloud KMS/HSM). Managed services (EKS, AKS, GKE) offer this as a setting — turn it on.
2. **RBAC**: very few principals may read Secrets; note that **create pod** in a namespace effectively grants read of any Secret there (mount it). Do not give developers {{get/list secrets}} in production.
3. Prefer **external secret stores** (AWS Secrets Manager, Azure Key Vault, Vault) synced via **External Secrets Operator** or mounted via the **Secrets Store CSI driver**; or avoid secrets entirely with workload identity (IRSA/Pod Identity/Azure workload identity).
4. Never commit Secrets to Git in plaintext; use Sealed Secrets/SOPS if Git must hold them.
5. Audit logging on secret reads.

**Consuming**
- **Environment variables**: simple, but fixed at container start — changes need a restart; values can leak via crash dumps or {{/proc}}.
- **Volume mounts**: files updated by the kubelet when the object changes (eventually, typically within a minute) — except {{subPath}} mounts, which never update.
- {{immutable: true}} for config that should never change (protects against accidents, reduces API server watch load).

**Reaching .NET pods**: {{IConfiguration}} with {{reloadOnChange}} on a mounted file picks up updates (note symlink-swap behaviour of projected volumes — use {{AddKeyPerFile}} or a polling file provider). Safer default: treat config changes as a **rollout** — hash the ConfigMap into a pod annotation (Helm/Kustomize do this) so a change triggers a controlled rolling update with health checks, instead of every pod changing behaviour at once.`,
  code: r`~~~yaml
apiVersion: v1
kind: ConfigMap
metadata: { name: payments-config, namespace: payments }
data:
  appsettings.Production.json: |
    { "Psp": { "BaseUrl": "https://api.psp.example", "TimeoutSeconds": 5 } }
---
# Deployment pod template excerpt: config as files, checksum annotation forces a controlled rollout on change
template:
  metadata:
    annotations:
      checksum/config: "3f2a9c..."              # Helm: sha256sum of the rendered ConfigMap
  spec:
    containers:
      - name: api
        volumeMounts: [ { name: config, mountPath: /app/config, readOnly: true } ]
    volumes:
      - name: config
        configMap: { name: payments-config }
~~~
~~~csharp
builder.Configuration.AddJsonFile("/app/config/appsettings.Production.json", optional: false, reloadOnChange: false);
// Secrets come from workload identity + Key Vault/Secrets Manager, not from Kubernetes Secrets where possible
~~~`,
  dia: r`flowchart LR
  GIT[Git: ConfigMap manifests] --> API[API server]
  SM[Secrets Manager / Key Vault] -->|External Secrets Operator| SEC[Secret]
  API --> ETCD[(etcd - KMS v2 envelope encryption)]
  SEC --> ETCD
  API --> POD[Pod: config volume + secret volume]
  POD -->|checksum change| RO[Rolling update]`,
  pts: [r`Secrets are base64-encoded, not encrypted; enable KMS encryption at rest.`, r`Restrict get/list secrets and remember create-pod implies secret read.`, r`Prefer external stores or workload identity over Kubernetes Secrets.`, r`Env vars are fixed at start; volumes update eventually; subPath never updates.`, r`Treat config changes as rollouts via checksum annotations.`],
  ex: r`An etcd backup copied to a shared bucket exposed every database password in a cluster; enabling KMS encryption and moving to External Secrets with short-lived credentials closed the gap.`,
  fu: [r`Why does pod create permission imply secret read?`, r`What is the risk of hot-reloading config in all pods at once?`],
  pit: [r`Believing base64 protects secrets.`, r`Plaintext Secrets in Git.`, r`subPath mounts expected to update.`] },

{ id: 'q7', level: 'Intermediate', tags: ['requests-limits', 'qos', 'cpu-throttling', 'oomkill'],
  q: r`Explain resource requests and limits, QoS classes, CPU throttling under CFS quotas, OOMKills and eviction — and how .NET's GC and thread pool behave inside containers.`,
  a: r`**Requests** are what the **scheduler** reserves: a pod fits on a node only if the sum of requests fits allocatable capacity. **Limits** are enforced at runtime by cgroups.
- **CPU limit** → CFS quota: a container with limit 1 CPU gets 100 ms of CPU time per 100 ms period across all its threads. A multi-threaded .NET app can burn its quota in 25 ms on 4 cores and then be **throttled** for 75 ms — latency spikes with low average CPU.
- **Memory limit** → exceeding it means the kernel **OOM-kills** the container (exit code 137, reason {{OOMKilled}}).

**QoS classes**
| Class | Rule | Eviction order under node pressure |
|---|---|---|
| **Guaranteed** | requests = limits for CPU and memory in every container | last |
| **Burstable** | some requests set, not equal to limits | middle (by usage over request) |
| **BestEffort** | no requests or limits | first |

**Node-pressure eviction**: when node memory/disk runs low, the kubelet evicts pods (reason {{Evicted}}) starting with those using most above their requests. Different from OOMKill (kernel, per container).

**Common guidance**
- Always set **memory requests = limits** for predictable behaviour (memory is not compressible).
- Set **CPU requests** realistically. **CPU limits are debated**: they cause throttling; many teams omit CPU limits for latency-sensitive services and rely on requests for fair sharing, while multi-tenant clusters may require them. Know the trade-off.

**.NET in containers**
- The runtime reads cgroup limits: {{Environment.ProcessorCount}} reflects the CPU limit (rounded up), and the **GC heap hard limit** defaults to 75% of the memory limit. Leave headroom for native memory, thread stacks and buffers.
- **Server GC** creates one heap per core; with a small CPU limit it may still be heavy — for small pods consider Workstation GC or {{DOTNET_GCHeapCount}}, and **DATAS** (dynamic adaptation, on by default with Server GC in .NET 9) to shrink heaps.
- Thread-pool starvation under throttling: blocked threads plus throttled CPU produce timeouts; avoid sync-over-async.
- Tune {{DOTNET_GCHeapHardLimitPercent}} if needed; watch {{container_cpu_cfs_throttled_periods_total}}.`,
  code: r`~~~yaml
resources:
  requests: { cpu: "500m", memory: "768Mi" }
  limits:   { memory: "768Mi" }                 # memory request = limit; no CPU limit for this latency-sensitive API
env:
  - { name: DOTNET_GCHeapHardLimitPercent, value: "0x46" }   # 70% of the limit for the managed heap (hex)
  - { name: DOTNET_gcServer, value: "1" }
~~~
~~~text
# PromQL: share of CFS periods throttled per container (alert if sustained > 10-20%)
sum by (namespace, pod, container) (rate(container_cpu_cfs_throttled_periods_total[5m]))
  / sum by (namespace, pod, container) (rate(container_cpu_cfs_periods_total[5m]))
~~~`,
  dia: r`flowchart TD
  SCH[Scheduler] -->|sum of requests fits?| NODE[Node allocatable]
  NODE --> CG[cgroups enforce limits]
  CG -->|CPU over quota| TH[Throttled until next 100 ms period]
  CG -->|memory over limit| OOM[OOMKilled - exit 137]
  NODE -->|memory pressure| EV[kubelet evicts BestEffort, then Burstable over request]`,
  pts: [r`Requests drive scheduling; limits are enforced by cgroups.`, r`CPU limits cause CFS throttling; memory limits cause OOMKills.`, r`QoS classes decide eviction order under node pressure.`, r`Memory request = limit; think hard before setting CPU limits.`, r`.NET reads cgroup limits: GC heap limit, processor count, Server GC and DATAS behaviour.`],
  ex: r`A quote API at 30% average CPU had p99 spikes of 400 ms; throttling metrics showed 40% of periods throttled under a 1-CPU limit. Removing the CPU limit and raising the request fixed the latency.`,
  fu: [r`Why can a container be OOMKilled while the node has free memory?`, r`When are CPU limits genuinely required?`],
  pit: [r`No requests (BestEffort) for production workloads.`, r`Memory limits far above requests, inviting eviction surprises.`, r`Diagnosing throttling from average CPU.`] },

{ id: 'q8', level: 'Intermediate', tags: ['scheduling', 'affinity', 'taints', 'topology-spread'],
  q: r`Control pod placement: node selectors and affinity, pod affinity and anti-affinity, taints and tolerations, topology spread constraints, and priority with preemption. Design placement for a highly available payments API.`,
  a: r`**Tools**
- **nodeSelector / node affinity**: run on nodes with labels (for example {{node-pool=payments}}, {{kubernetes.io/arch=arm64}}). {{requiredDuringScheduling...}} is hard; {{preferred...}} is weighted.
- **Taints and tolerations**: a taint **repels** pods unless they tolerate it ({{dedicated=payments:NoSchedule}}). Taints keep others off a node pool; affinity pulls your pods onto it — use **both** for dedicated pools.
- **Pod anti-affinity**: keep replicas apart (by hostname or zone). Hard anti-affinity per node limits replicas to node count and is expensive to compute at scale.
- **Topology spread constraints**: spread pods evenly across zones/nodes with {{maxSkew}}; the preferred modern tool for HA spreading.
- **PriorityClasses**: higher-priority pods can **preempt** (evict) lower-priority ones when resources are short — protect critical workloads, but beware preempting important batch jobs.

**HA placement for a payments API (9 replicas, 3 zones)**
1. Dedicated node pool: taint {{dedicated=payments:NoSchedule}} + node affinity, so noisy workloads cannot land there (also helps PCI segmentation).
2. **Topology spread** across zones with {{maxSkew: 1}}, {{whenUnsatisfiable: DoNotSchedule}} — 3 pods per zone.
3. Second spread constraint across hostnames ({{ScheduleAnyway}}) so a node failure loses few replicas.
4. **PodDisruptionBudget** ({{minAvailable: 6}}) for voluntary disruptions.
5. A **PriorityClass** above batch workloads.
6. Capacity for N-1 zones (static stability): 9 replicas where 6 can carry peak.

**Pitfalls**
- Zone spread with {{DoNotSchedule}} can leave pods **Pending** if one zone lacks capacity — the autoscaler must be able to add nodes per zone (separate node groups per AZ for Cluster Autoscaler; Karpenter handles this natively).
- Persistent volumes are zonal: a pod bound to an EBS/managed disk can only run in that zone.
- Over-constraining makes the scheduler unable to place pods during incidents, exactly when you need flexibility.`,
  code: r`~~~yaml
spec:
  priorityClassName: payments-critical
  tolerations:
    - { key: dedicated, operator: Equal, value: payments, effect: NoSchedule }
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions: [ { key: node-pool, operator: In, values: [payments] } ]
  topologySpreadConstraints:
    - maxSkew: 1
      topologyKey: topology.kubernetes.io/zone
      whenUnsatisfiable: DoNotSchedule
      labelSelector: { matchLabels: { app: payments-api } }
    - maxSkew: 1
      topologyKey: kubernetes.io/hostname
      whenUnsatisfiable: ScheduleAnyway
      labelSelector: { matchLabels: { app: payments-api } }
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata: { name: payments-critical }
value: 100000
preemptionPolicy: PreemptLowerPriority
description: "Customer-facing payment paths"
~~~`,
  dia: r`flowchart TB
  subgraph ZA[Zone a - payments pool, tainted]
    A1[pod]
    A2[pod]
    A3[pod]
  end
  subgraph ZB[Zone b]
    B1[pod]
    B2[pod]
    B3[pod]
  end
  subgraph ZC[Zone c]
    C1[pod]
    C2[pod]
    C3[pod]
  end
  OTHER[Batch / other workloads] -.repelled by taint.-> ZA`,
  pts: [r`Affinity attracts, taints repel: combine them for dedicated pools.`, r`Topology spread constraints are the main HA spreading tool.`, r`Priority and preemption protect critical workloads.`, r`Plan N-1 zone capacity and PDBs.`, r`Watch Pending pods from over-constraint and zonal volumes.`],
  ex: r`A bank's payments pods all landed in one zone because only that zone had free capacity; adding zone topology spread with DoNotSchedule and per-zone node groups fixed the skew.`,
  fu: [r`Why is hard pod anti-affinity expensive in large clusters?`, r`How does Karpenter interact with topology spread constraints?`],
  pit: [r`Taints without affinity (pods can still land elsewhere).`, r`Over-constrained placement causing Pending pods in incidents.`, r`Forgetting zonal volumes pin pods to zones.`] },

{ id: 'q9', level: 'Intermediate', tags: ['storage', 'statefulsets', 'persistent-volumes', 'csi'],
  q: r`Explain Kubernetes storage: PersistentVolumes, PersistentVolumeClaims, StorageClasses and CSI, access modes, volumeBindingMode, and StatefulSets' stable identity. Should you run your production database on Kubernetes?`,
  a: r`**Objects**
- **PersistentVolumeClaim (PVC)**: a pod's request for storage (size, access mode, StorageClass).
- **StorageClass**: how to dynamically provision volumes (CSI driver, disk type, IOPS, encryption, {{reclaimPolicy}}, {{allowVolumeExpansion}}).
- **PersistentVolume (PV)**: the actual provisioned volume bound to a claim.
- **CSI drivers** (EBS, Azure Disk, Persistent Disk, EFS/Azure Files, Ceph) implement provisioning, attach, mount, snapshots and resize.

**Access modes**: {{ReadWriteOnce}} (one node; block disks), {{ReadWriteOncePod}} (one pod), {{ReadOnlyMany}}, {{ReadWriteMany}} (network file systems — NFS, EFS, Azure Files; slower, different consistency).

**volumeBindingMode: WaitForFirstConsumer**: delay provisioning until the pod is scheduled, so the disk is created in the **same zone** as the pod. With {{Immediate}}, a disk can be created in zone a while the pod can only schedule in zone b → stuck pod.

**reclaimPolicy**: {{Delete}} removes the cloud disk when the PVC is deleted; use {{Retain}} for important data.

**StatefulSets** give each replica a **stable identity**: ordinal names ({{kafka-0}}), stable DNS via a headless Service, and a **dedicated PVC per replica** via {{volumeClaimTemplates}} that survives pod rescheduling. Ordered, one-at-a-time rollouts (or {{Parallel}} management) and partitioned updates.

**Should the production database run on Kubernetes?**
- **Prefer managed databases** (RDS/Aurora, Azure SQL, Cloud SQL) for most organisations: backups, PITR, patching, failover, read replicas and expertise are provided; your team's time goes to the product.
- Running databases on Kubernetes is viable with **mature operators** (CloudNativePG, Strimzi for Kafka, Vitess) and a team that understands storage, failover and backups deeply — for portability, cost at scale, or on-premises/sovereign requirements.
- The hard parts are not the StatefulSet: they are **backup/restore drills, failover correctness, storage performance, upgrades and on-call expertise**.`,
  code: r`~~~yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata: { name: gp3-encrypted }
provisioner: ebs.csi.aws.com
parameters: { type: gp3, encrypted: "true", iops: "6000", throughput: "250" }
volumeBindingMode: WaitForFirstConsumer          # disk created in the pod's zone
reclaimPolicy: Retain
allowVolumeExpansion: true
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: risk-cache }
spec:
  serviceName: risk-cache                         # headless Service for stable DNS: risk-cache-0.risk-cache...
  replicas: 3
  selector: { matchLabels: { app: risk-cache } }
  template:
    metadata: { labels: { app: risk-cache } }
    spec:
      containers:
        - name: cache
          image: registry.example/risk-cache:2.4.0
          volumeMounts: [ { name: data, mountPath: /data } ]
  volumeClaimTemplates:
    - metadata: { name: data }
      spec: { accessModes: [ReadWriteOnce], storageClassName: gp3-encrypted, resources: { requests: { storage: 100Gi } } }
~~~`,
  dia: r`flowchart LR
  STS[StatefulSet risk-cache] --> P0[risk-cache-0]
  STS --> P1[risk-cache-1]
  P0 --> PVC0[PVC data-risk-cache-0] --> PV0[(PV: EBS gp3 zone a)]
  P1 --> PVC1[PVC data-risk-cache-1] --> PV1[(PV: EBS gp3 zone b)]
  SC[StorageClass gp3-encrypted - WaitForFirstConsumer] -.provisions.-> PV0
  SC -.provisions.-> PV1`,
  pts: [r`PVC requests, StorageClass provisions via CSI, PV is the bound volume.`, r`Access modes: RWO for block disks, RWX needs network file systems.`, r`WaitForFirstConsumer avoids cross-zone binding problems; Retain for important data.`, r`StatefulSets give stable names, DNS and per-replica PVCs.`, r`Prefer managed databases unless you have a mature operator and expertise.`],
  ex: r`A team's Postgres StatefulSet used an Immediate-binding StorageClass; after a zone drain, pods could not start because their disks lived in the drained zone. WaitForFirstConsumer and a managed database followed.`,
  fu: [r`How do you resize a PVC in place?`, r`What does an operator add beyond a StatefulSet?`],
  pit: [r`Immediate binding with zonal disks.`, r`reclaimPolicy Delete on critical data.`, r`Assuming a StatefulSet makes a database highly available.`] },

{ id: 'q10', level: 'Intermediate', tags: ['jobs', 'cronjobs', 'daemonsets', 'batch'],
  q: r`Run batch work correctly: Jobs (completions, parallelism, backoffLimit, pod failure policy, deadlines), CronJobs (concurrencyPolicy, missed schedules, time zones), and when DaemonSets are the right tool.`,
  a: r`**Jobs** run pods to completion.
- {{completions}} and {{parallelism}}: run N successful pods with up to M at once; **Indexed** jobs give each pod {{JOB_COMPLETION_INDEX}} for sharded work (for example 16 shards of a reconciliation run).
- {{backoffLimit}} (default 6): retries before the Job is marked failed; **backoffLimitPerIndex** limits retries per shard.
- **podFailurePolicy**: treat specific exit codes as non-retryable (bad input → fail fast) and ignore disruptions (node drain → do not count as failure).
- {{activeDeadlineSeconds}}: hard time limit for the whole Job; {{ttlSecondsAfterFinished}}: clean up finished Jobs and pods.
- Pods may run **more than once** (retries, node failures) — work must be **idempotent** or checkpointed.

**CronJobs** create Jobs on a schedule.
- {{concurrencyPolicy}}: {{Allow}} (default — overlapping runs!), {{Forbid}} (skip if the previous run is still going), {{Replace}}.
- {{startingDeadlineSeconds}}: if the controller missed the schedule (control plane down) by more than this, skip; without it, more than 100 missed schedules stop the CronJob from being scheduled.
- {{timeZone}} field (for example {{Europe/London}}) instead of assuming UTC — matters for end-of-day banking jobs and DST.
- Scheduling is at-least-once-ish, not exact: a run can be missed or (rarely) doubled; design the job to be safe either way (a lock/lease or idempotent writes, plus a business-date parameter).
- {{successfulJobsHistoryLimit}} / {{failedJobsHistoryLimit}} for debuggability.

**DaemonSets** run one pod per (selected) node: log shippers, node exporters, CNI agents, security agents, CSI node plugins. Use node selectors/tolerations to target node pools; update with rolling updates and {{maxUnavailable}}. Not for application workloads that should scale by demand.

**Alternatives**: for complex DAGs and retries across steps use a workflow engine (Argo Workflows, Temporal, Step Functions/Durable Functions); for event-driven queue draining use KEDA ScaledJobs.`,
  code: r`~~~yaml
apiVersion: batch/v1
kind: CronJob
metadata: { name: eod-reconciliation, namespace: finance }
spec:
  schedule: "30 22 * * 1-5"
  timeZone: "Europe/London"
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 1800
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      completionMode: Indexed
      completions: 16
      parallelism: 4
      backoffLimitPerIndex: 2
      activeDeadlineSeconds: 7200
      ttlSecondsAfterFinished: 86400
      podFailurePolicy:
        rules:
          - { action: FailJob, onExitCodes: { containerName: recon, operator: In, values: [42] } }   # bad input: do not retry
          - { action: Ignore,  onPodConditions: [ { type: DisruptionTarget } ] }                     # node drain: not a failure
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: recon
              image: registry.example/recon:3.2.0
              args: ["--shard=$(JOB_COMPLETION_INDEX)", "--shards=16", "--business-date=auto"]
~~~`,
  dia: r`flowchart LR
  CJ[CronJob 22:30 Europe/London, Forbid] --> J[Job: 16 indexed completions, parallelism 4]
  J --> P0[shard 0]
  J --> P1[shard 1]
  J --> P2[...]
  P0 --> DB[(Ledger - idempotent writes by business date + shard)]
  P1 --> DB`,
  pts: [r`Jobs: completions, parallelism, indexed sharding, backoff limits, deadlines, TTL.`, r`podFailurePolicy distinguishes bad input from disruptions.`, r`CronJobs: Forbid concurrency, startingDeadlineSeconds, timeZone.`, r`Runs can repeat or be missed: idempotent work with a business date.`, r`DaemonSets for per-node agents, not scalable apps.`],
  ex: r`An end-of-day job ran twice after the default concurrencyPolicy Allow overlapped a slow run; Forbid plus idempotent postings keyed by business date stopped double fees.`,
  fu: [r`What happens to a CronJob after more than 100 missed schedules?`, r`When would you move batch work to Argo Workflows?`],
  pit: [r`Default concurrencyPolicy Allow for non-reentrant jobs.`, r`Non-idempotent batch steps.`, r`Assuming CronJob schedules are UTC-safe across DST.`] },

{ id: 'q11', level: 'Intermediate', tags: ['ingress', 'gateway-api', 'north-south'],
  q: r`Ingress versus Gateway API: what problems does Gateway API solve, how do GatewayClass, Gateway and HTTPRoute divide responsibilities, and how would you migrate an estate built on ingress-nginx?`,
  a: r`**Ingress** (networking.k8s.io/v1): host and path rules mapped to Services, TLS termination, implemented by an ingress controller. Limitations: a lowest-common-denominator spec, so features (rewrites, timeouts, canary weights, header matching) live in **controller-specific annotations** — unportable and hard to validate; one object mixes infrastructure and application concerns; HTTP-only.

**Gateway API** (v1 since 2023) is the successor:
- **GatewayClass** (infra provider): which implementation (Envoy Gateway, Istio, Cilium, AWS/Azure/GCP controllers, NGINX Gateway Fabric).
- **Gateway** (platform team): listeners, ports, TLS certificates, which namespaces may attach routes.
- **HTTPRoute / GRPCRoute / TLSRoute / TCPRoute** (app teams): matching on path, headers, query, method; **weighted backends** for canaries; filters (header modification, redirects, URL rewrites, request mirroring); timeouts.
- **ReferenceGrant** for safe cross-namespace references.

**Why it matters**: role separation maps to how organisations work (platform owns the Gateway, teams own Routes), richer standard features reduce annotations, and the same API also covers service-mesh (east-west) routing through the GAMMA initiative.

**ingress-nginx**: the community ingress-nginx controller was announced for retirement by Kubernetes SIG Network in late 2025, with best-effort maintenance only for a short period after — so estates built on it need a migration plan regardless of preference.

**Migration plan**
1. Inventory Ingress objects and **annotations** (rewrites, auth, rate limits, snippets — custom snippets are also a security risk).
2. Pick a Gateway API implementation that covers your features; run it **in parallel** with a new load balancer.
3. Convert with tooling (ingress2gateway) and review by hand; map annotations to Route filters/policies.
4. Shift traffic gradually (DNS weights or per-host cut-over), compare error rates and latency.
5. Decommission the old controller; enforce via admission policy that new Ingress objects are rejected.`,
  code: r`~~~yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata: { name: public, namespace: platform-gw }
spec:
  gatewayClassName: envoy
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      hostname: "api.bank.example"
      tls: { certificateRefs: [ { name: api-bank-example-tls } ] }
      allowedRoutes: { namespaces: { from: Selector, selector: { matchLabels: { gateway-access: public } } } }
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: { name: payments, namespace: payments }
spec:
  parentRefs: [ { name: public, namespace: platform-gw } ]
  hostnames: ["api.bank.example"]
  rules:
    - matches: [ { path: { type: PathPrefix, value: /v1/payments } } ]
      timeouts: { request: 10s }
      backendRefs:
        - { name: payments-api-stable, port: 80, weight: 90 }
        - { name: payments-api-canary, port: 80, weight: 10 }      # canary without annotations
~~~`,
  dia: r`flowchart LR
  INFRA[Infra provider: GatewayClass envoy] --> GW[Platform team: Gateway public - TLS, listeners]
  GW --> R1[Payments team: HTTPRoute /v1/payments]
  GW --> R2[Cards team: HTTPRoute /v1/cards]
  R1 -->|90| S1[payments-api-stable]
  R1 -->|10| S2[payments-api-canary]`,
  pts: [r`Ingress is minimal; real features hide in unportable annotations.`, r`Gateway API splits GatewayClass, Gateway and Routes by role.`, r`Standard weighted backends, header matching, filters and timeouts.`, r`Covers north-south and, via GAMMA, mesh routing.`, r`ingress-nginx retirement makes migration planning necessary.`],
  ex: r`A platform team migrated 400 Ingress objects to Gateway API with ingress2gateway plus manual review; 60 custom configuration snippets were removed, closing a long-standing security finding.`,
  fu: [r`How do you prevent one team's HTTPRoute from hijacking another team's hostname?`, r`What features still need implementation-specific policies?`],
  pit: [r`Relying on configuration snippets in annotations.`, r`Letting every namespace attach routes to the public Gateway.`, r`Big-bang controller swaps.`] },

{ id: 'q12', level: 'Intermediate', tags: ['networkpolicy', 'segmentation', 'cni'],
  q: r`Design NetworkPolicies for a multi-service namespace: default deny, allowing ingress and egress (including DNS), namespace selectors, and what your CNI must support. What can NetworkPolicy not do?`,
  a: r`**Default behaviour**: all pods can talk to all pods across all namespaces. NetworkPolicy changes that **only if the CNI enforces it** (Calico, Cilium, Antrea, cloud CNIs with policy enabled) — on a CNI without support, policies are silently ignored.

**Semantics**
- A policy selects pods ({{podSelector}}) and declares {{policyTypes}} (Ingress, Egress).
- Once a pod is selected by any policy for a direction, **only explicitly allowed traffic** is permitted in that direction (allow-lists, additive across policies).
- Peers: {{podSelector}}, {{namespaceSelector}}, both combined (pods matching labels **in** matching namespaces — mind the YAML: one list item with both selectors vs two items means AND vs OR), and {{ipBlock}} for external CIDRs.

**Pattern**
1. **Default deny** ingress and egress for the namespace.
2. Allow **DNS egress** to CoreDNS (UDP and TCP 53) — the first thing that breaks.
3. Allow ingress to the API only from the gateway namespace's pods on the app port.
4. Allow the API's egress to its database/cache/queue (pods or CIDRs/endpoint IPs) and to specific external endpoints.
5. Allow monitoring scrapes from the observability namespace.

**What NetworkPolicy cannot do**
- **No layer 7**: cannot allow {{GET /v1/accounts}} but deny {{DELETE}}; cannot match FQDNs (egress to {{api.psp.example}}) in the standard API — Cilium/Calico extensions provide FQDN and L7 policy; a service mesh provides L7 authorisation.
- **No identity beyond labels**: anyone who can label a pod (or create pods in an allowed namespace) gets its access — pair with RBAC and admission control.
- **No explicit deny rules** in the core API (only allow-lists); cluster-wide admin policies are arriving via AdminNetworkPolicy and CNI-specific policies.
- **No logging** by default (CNI tools like Hubble/Calico flow logs provide it).
- Does not encrypt traffic — that is mTLS (mesh) or WireGuard/IPsec in the CNI.`,
  code: r`~~~yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny-all, namespace: payments }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-dns, namespace: payments }
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } }
          podSelector: { matchLabels: { k8s-app: kube-dns } }
      ports: [ { protocol: UDP, port: 53 }, { protocol: TCP, port: 53 } ]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: api-from-gateway, namespace: payments }
spec:
  podSelector: { matchLabels: { app: payments-api } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: platform-gw } }   # same item = AND
          podSelector: { matchLabels: { app: envoy-gateway } }
      ports: [ { protocol: TCP, port: 8080 } ]
~~~`,
  dia: r`flowchart LR
  GW[platform-gw: envoy pods] -->|8080 allowed| API[payments-api]
  OTHER[other namespaces] -.denied.-> API
  API -->|53 allowed| DNS[CoreDNS]
  API -->|5432 allowed| DB[(ledger DB)]
  API -.denied by default.-> NET[Internet]
  MON[observability: prometheus] -->|metrics port| API`,
  pts: [r`Policies only work if the CNI enforces them.`, r`Default deny both directions, then explicit allows; DNS egress first.`, r`Selector combinations: same item AND, separate items OR.`, r`No L7, no FQDNs, no explicit deny in the core API: use CNI extensions or a mesh.`, r`Labels are identity here: protect who can label and create pods.`],
  ex: r`A PCI assessment flagged flat pod networking; default-deny policies with explicit allows per service, verified with Cilium Hubble flow logs, provided the segmentation evidence.`,
  fu: [r`How would you restrict egress to a PSP by domain name?`, r`How do you test policies before enforcing them?`],
  pit: [r`Applying policies on a CNI that ignores them.`, r`Forgetting DNS egress after default deny.`, r`Misreading AND vs OR selector semantics.`] },

{ id: 'q13', level: 'Intermediate', tags: ['rbac', 'service-accounts', 'least-privilege'],
  q: r`Design Kubernetes RBAC for platform engineers, application teams, CI/CD and workloads: Roles versus ClusterRoles, bindings, service accounts and projected tokens, and the privilege-escalation paths to block.`,
  a: r`**Model**: RBAC is **additive allow-only**. A **Role** (namespaced) or **ClusterRole** (cluster-wide or reusable) lists verbs on resources; a **RoleBinding** grants it within one namespace, a **ClusterRoleBinding** grants it everywhere. Subjects: users and groups (from your OIDC IdP or cloud IAM mapping) and **ServiceAccounts**.

**Personas**
| Persona | Grant |
|---|---|
| Platform admins | cluster-admin only via break-glass / just-in-time elevation (PIM, Teleport, cloud IAM) |
| App team (prod) | read-only in their namespaces (get/list/watch pods, logs, events); **no** secrets read; changes via GitOps |
| App team (dev) | edit in their namespaces |
| CI/CD or GitOps controller | scoped to target namespaces; no cluster-wide rights unless it manages cluster add-ons |
| Workloads | a dedicated ServiceAccount per app with **no** Kubernetes API rights unless needed |

**Service accounts and tokens**: pods receive **projected, audience-bound, time-limited tokens** (rotated by the kubelet) — not the old non-expiring Secret tokens. Set {{automountServiceAccountToken: false}} for pods that do not call the API (most apps). Cloud access uses workload identity (IRSA/Pod Identity/Azure workload identity) mapped to the ServiceAccount.

**Privilege-escalation paths to block**
- {{create pods}} in a namespace ⇒ can mount any Secret and run as any ServiceAccount there.
- {{escalate}}, {{bind}}, {{impersonate}} verbs; editing RoleBindings.
- {{nodes/proxy}}, {{pods/exec}} and {{pods/attach}} in production (exec = shell into payment pods).
- Wildcards ({{*}}) on resources or verbs; {{system:masters}} group membership (bypasses RBAC entirely — never map humans to it).
- Write access to webhook configurations, CRDs that controllers act on, or {{persistentvolumes}} (hostPath).
- Privileged pods (blocked by Pod Security, q14) are the shortcut to node root.

**Operations**: groups from the IdP, never individual users; RBAC manifests in Git; periodic access review ({{kubectl auth can-i --list --as}}, tools like rbac-lookup); audit logs for exec and secret access.`,
  code: r`~~~yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: app-readonly, namespace: payments }
rules:
  - apiGroups: ["", "apps", "batch"]
    resources: ["pods", "pods/log", "services", "endpoints", "events", "deployments", "replicasets", "jobs", "configmaps"]
    verbs: ["get", "list", "watch"]          # deliberately no secrets, no pods/exec
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: payments-team-readonly, namespace: payments }
subjects: [ { kind: Group, name: "grp-payments-engineers", apiGroup: rbac.authorization.k8s.io } ]
roleRef: { kind: Role, name: app-readonly, apiGroup: rbac.authorization.k8s.io }
---
apiVersion: v1
kind: ServiceAccount
metadata: { name: payments-api, namespace: payments }
automountServiceAccountToken: false        # the app never calls the Kubernetes API
~~~
~~~bash
kubectl auth can-i create pods -n payments --as-group=grp-payments-engineers --as=someone@bank.example   # expect: no
kubectl auth can-i --list -n payments --as=system:serviceaccount:payments:payments-api
~~~`,
  dia: r`flowchart LR
  IDP[Corporate IdP groups] --> RB[RoleBinding: payments-team-readonly]
  RB --> R[Role: app-readonly - no secrets, no exec]
  GITOPS[GitOps controller SA] --> RB2[RoleBinding: deployer in payments]
  POD[payments-api pod] --> SA[ServiceAccount - no API rights, no token mount]
  SA -->|workload identity| CLOUD[Cloud IAM role]
  BG[Break-glass admin - JIT, audited] --> CA[cluster-admin]`,
  pts: [r`RBAC is additive; Roles/ClusterRoles bound by RoleBindings/ClusterRoleBindings.`, r`Read-only prod access for humans; changes through GitOps.`, r`Dedicated ServiceAccounts; no token automount unless needed; projected tokens.`, r`Block escalation: create pods, escalate/bind/impersonate, exec, wildcards, system:masters.`, r`Groups from the IdP, RBAC in Git, regular access reviews.`],
  ex: r`An access review found a CI ServiceAccount with cluster-admin used by 40 pipelines; scoping it per namespace removed the single credential that could have taken over every cluster.`,
  fu: [r`Why does pods/exec matter so much in a payments namespace?`, r`How do you grant temporary production debug access?`],
  pit: [r`Mapping users to system:masters.`, r`Wildcard verbs or resources.`, r`Default ServiceAccount tokens mounted everywhere.`] },

{ id: 'q14', level: 'Intermediate', tags: ['pod-security', 'security-context', 'hardening'],
  q: r`Harden workloads: Pod Security Standards and Pod Security Admission, the securityContext settings every .NET container should have, and what "privileged" really allows.`,
  a: r`**Pod Security Standards** (replaced PodSecurityPolicy, removed in 1.25):
- **Privileged**: unrestricted.
- **Baseline**: blocks known escalations (privileged containers, host namespaces, hostPath, dangerous capabilities).
- **Restricted**: baseline plus non-root, no privilege escalation, drop ALL capabilities, seccomp RuntimeDefault, restricted volume types.

**Pod Security Admission** enforces them per namespace via labels, in three modes: {{enforce}} (reject), {{audit}} (log), {{warn}} (warn the user). Roll out with warn/audit first, then enforce **restricted** for application namespaces. For finer rules (allowed registries, required labels, image signatures) add a policy engine (Kyverno, Gatekeeper, ValidatingAdmissionPolicy — q19).

**securityContext for a .NET API**
- {{runAsNonRoot: true}}, a fixed non-root UID (the .NET images provide the {{app}} user, UID 1654).
- {{allowPrivilegeEscalation: false}}.
- {{readOnlyRootFilesystem: true}} with an {{emptyDir}} for {{/tmp}} if needed.
- {{capabilities: drop: [ALL]}} — Kestrel on port 8080 needs none (ports below 1024 would need NET_BIND_SERVICE; just use 8080).
- {{seccompProfile: RuntimeDefault}}.
- Chiseled/distroless images: no shell or package manager for attackers to use.

**What privileged means**: a privileged container (or one with hostPID/hostNetwork/hostPath of {{/}}, or SYS_ADMIN) can effectively **become root on the node**: see all processes, load kernel modules, read other pods' secrets on that node, and pivot to the kubelet's credentials. One privileged pod compromises the node and everything scheduled on it. Allow it only for vetted infrastructure (CNI, CSI, security agents) in dedicated namespaces.

**Beyond pods**: node hardening (managed node images, auto-patching), restricted access to the instance metadata service from pods (IMDSv2 hop limit 1 / blocking IMDS), runtime threat detection (Falco, cloud runtime protection), and sandboxed runtimes (gVisor, Kata) for untrusted code.`,
  code: r`~~~yaml
apiVersion: v1
kind: Namespace
metadata:
  name: payments
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/warn: restricted
---
# Deployment pod template excerpt
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1654                     # 'app' user in Microsoft .NET images
    fsGroup: 1654
    seccompProfile: { type: RuntimeDefault }
  containers:
    - name: api
      image: registry.example/payments-api@sha256:9c1e...   # built FROM mcr.microsoft.com/dotnet/aspnet:8.0-noble-chiseled
      ports: [ { containerPort: 8080 } ]
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities: { drop: ["ALL"] }
      volumeMounts: [ { name: tmp, mountPath: /tmp } ]
  volumes: [ { name: tmp, emptyDir: { sizeLimit: 256Mi } } ]
~~~`,
  dia: r`flowchart LR
  REQ[Pod create request] --> PSA{Pod Security Admission - namespace label restricted}
  PSA -->|privileged, root, hostPath| REJ[Rejected]
  PSA -->|compliant| POL{Policy engine: registry, signature, labels}
  POL -->|ok| RUN[Pod runs: non-root, read-only FS, no caps, seccomp]`,
  pts: [r`Pod Security Standards: privileged, baseline, restricted; PSA enforces per namespace.`, r`Roll out with warn/audit, then enforce restricted for apps.`, r`.NET containers: non-root UID, no escalation, read-only root FS, drop ALL, seccomp.`, r`Privileged or host-namespace pods equal node root.`, r`Add policy engines, node hardening, IMDS protection and runtime detection.`],
  ex: r`A penetration test escaped from a debug pod running privileged into the node and read another team's mounted secrets; enforcing restricted PSA in app namespaces closed the path.`,
  fu: [r`Which workloads legitimately need privileged access, and how do you contain them?`, r`How does a read-only root filesystem affect .NET apps?`],
  pit: [r`Running containers as root by default.`, r`Granting privileged for convenience in debugging.`, r`Enforcing restricted without a warn/audit phase.`] },

{ id: 'q15', level: 'Intermediate', tags: ['hpa', 'autoscaling', 'keda', 'custom-metrics'],
  q: r`How does the Horizontal Pod Autoscaler calculate replicas? Explain resource versus custom and external metrics, stabilisation windows and scaling policies, KEDA, and VPA's role.`,
  a: r`**Algorithm**: {{desiredReplicas = ceil(currentReplicas × currentMetricValue / targetMetricValue)}}, evaluated every 15 s by default, skipping changes within a ±10% tolerance. With several metrics, HPA takes the **maximum** of the proposals.
- Example: 4 replicas at 90% CPU (of requests) with target 60% → ceil(4 × 90/60) = 6.
- CPU utilisation is relative to **requests**, so wrong requests make HPA wrong.

**Metric types**
- **Resource** (CPU, memory via metrics-server). Memory is a poor scaling signal for .NET (the GC keeps memory once allocated).
- **Pods/Object custom metrics** via a metrics adapter (Prometheus Adapter): requests per second per pod, in-flight requests, latency.
- **External metrics**: queue depth, Kafka lag, cloud metrics.

**Behaviour tuning** ({{behavior}} field)
- **Scale-down stabilisation window** (default 300 s) uses the highest recommendation in the window — prevents flapping.
- **Policies**: limit change rate (for example, scale up by 100% or 10 pods per 30 s, whichever is larger; scale down 10% per minute).
- Scale up fast, scale down slowly.

**KEDA**: an event-driven autoscaler that feeds HPA with external metrics from 60+ scalers (Kafka lag, SQS/Service Bus/RabbitMQ depth, Prometheus queries, cron) and supports **scale to zero** (HPA alone has min 1). ScaledJobs for run-to-completion work.

**VPA**: recommends or sets requests/limits from observed usage. Do not run VPA in auto mode on CPU/memory alongside HPA on the same metric — they fight. Common pattern: VPA in **recommendation mode** to right-size requests, HPA for replicas. In-place pod resize (beta in recent releases) reduces the restart cost of VPA updates.

**Prerequisites for HPA to help**: the app must scale horizontally (stateless, no per-pod bottleneck), downstream must absorb more pods (database connections!), node autoscaling must add capacity fast enough, and maxReplicas must reflect downstream limits.`,
  code: r`~~~yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: payments-api, namespace: payments }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: payments-api }
  minReplicas: 6
  maxReplicas: 40                                  # bounded by DB connection budget (40 x pool 20 = 800 < 1000)
  metrics:
    - type: Pods
      pods:
        metric: { name: http_server_active_requests }
        target: { type: AverageValue, averageValue: "30" }
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 65 } }
  behavior:
    scaleUp:   { stabilizationWindowSeconds: 0, policies: [ { type: Percent, value: 100, periodSeconds: 30 } ] }
    scaleDown: { stabilizationWindowSeconds: 300, policies: [ { type: Percent, value: 10, periodSeconds: 60 } ] }
---
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: { name: settlement-worker, namespace: payments }
spec:
  scaleTargetRef: { name: settlement-worker }
  minReplicaCount: 0
  maxReplicaCount: 25
  triggers:
    - type: kafka
      metadata: { bootstrapServers: kafka:9092, consumerGroup: settlement, topic: payments.captured, lagThreshold: "500" }
~~~`,
  dia: r`flowchart LR
  MS[metrics-server: CPU] --> HPA[HPA controller - every 15 s]
  PA[Prometheus Adapter: active requests] --> HPA
  KEDA[KEDA: Kafka lag, queue depth] -->|external metrics| HPA
  HPA -->|ceil current x metric / target| DEP[Deployment replicas]
  VPA[VPA recommender] -.right-size requests.-> DEP
  DEP --> CA[Node autoscaler adds nodes]`,
  pts: [r`desired = ceil(current x metric / target); max across metrics; 10% tolerance.`, r`CPU utilisation is relative to requests; memory is a poor .NET signal.`, r`behavior: fast scale-up, slow scale-down with stabilisation.`, r`KEDA for event-driven metrics and scale to zero.`, r`VPA for right-sizing, not on the same metric as HPA; cap max by downstream limits.`],
  ex: r`A card-auth API scaled on memory and never scaled down because .NET held its heap; switching to active-requests per pod with CPU as a backstop made scaling track load.`,
  fu: [r`Why can HPA make an outage worse?`, r`How do you scale on p99 latency safely?`],
  pit: [r`Scaling on memory for .NET services.`, r`maxReplicas ignoring database limits.`, r`VPA and HPA fighting over CPU.`] },

{ id: 'q16', level: 'Intermediate', tags: ['helm', 'kustomize', 'packaging'],
  q: r`Helm versus Kustomize: how does each work, how do Helm releases, upgrades and rollbacks behave, what are the common templating pitfalls, and how do you structure charts for 30 services?`,
  a: r`**Helm**: a package manager. A **chart** = templates (Go templating) + {{values.yaml}} + metadata; a **release** = an installed instance whose state is stored as Secrets in the namespace. {{helm upgrade --install}} renders and applies; {{helm rollback}} re-applies a previous release's manifests. Charts are distributed via OCI registries.

**Kustomize**: template-free overlays built into kubectl. A **base** of plain YAML plus **overlays** (dev/test/prod) applying patches, name prefixes, labels, image tags and generated ConfigMaps (with content hashes that trigger rollouts).

**Choosing**: Helm for distributing reusable packages (third-party software, an internal "standard service" chart); Kustomize for environment-specific overlays of plain manifests. Many teams combine them: render a Helm chart, then patch with Kustomize, all driven by GitOps.

**Helm pitfalls**
- **Templating YAML with text templates**: indentation bugs, {{toYaml}}/{{nindent}} misuse, type coercion (a value of {{0123}} or {{yes}}) — lint and test rendered output.
- **Over-parameterised charts** that expose every field become unreadable; provide opinionated defaults.
- **Rollback does not roll back data**: CRD changes, schema migrations and PVCs are not reverted; Helm does not upgrade CRDs in the {{crds/}} folder after first install.
- **Hooks** (pre-upgrade migration Jobs) can fail halfway and leave the release in {{pending-upgrade}}; prefer explicit migration steps in the pipeline.
- Drift: someone edits live objects; Helm's three-way merge may or may not restore them.
- Secrets in values files — use external secrets.

**Structure for 30 services**
- One internal **library or application chart** ("standard-service") encoding company defaults: probes, securityContext, PDB, HPA, ServiceMonitor, NetworkPolicy, topology spread.
- Each service has a small values file per environment in its repo or a GitOps repo.
- Chart versions follow SemVer; changes to the shared chart go through review and canary services.
- CI: {{helm lint}}, {{helm template}} + schema validation (kubeconform), policy checks (Conftest/Kyverno CLI), and diff ({{helm diff}}) on pull requests.`,
  code: r`~~~yaml
# values-prod.yaml for one service using the company standard-service chart
image: { repository: registry.example/payments-api, digest: "sha256:9c1e..." }
replicas: { min: 6, max: 40 }
resources: { requests: { cpu: 500m, memory: 768Mi }, limits: { memory: 768Mi } }
probes: { live: /health/live, ready: /health/ready, startupSeconds: 120 }
pdb: { minAvailable: 4 }
networkPolicy: { allowFrom: [ { namespace: platform-gw, app: envoy-gateway } ], egressTo: [ ledger-db, kafka ] }
~~~
~~~text
{{- /* templates/deployment.yaml (excerpt): safe rendering helpers */ -}}
        resources:
          {{- toYaml .Values.resources | nindent 10 }}
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
~~~`,
  dia: r`flowchart LR
  LIB[standard-service chart v3.4 - company defaults] --> S1[payments-api values-prod]
  LIB --> S2[cards-api values-prod]
  S1 --> CI[CI: lint, template, kubeconform, policy, diff]
  S2 --> CI
  CI --> GIT[GitOps repo]
  GIT --> ARGO[Argo CD renders and applies]`,
  pts: [r`Helm packages and versions releases; Kustomize overlays plain YAML.`, r`Rollback re-applies manifests but not data, CRDs or migrations.`, r`Text templating pitfalls: indentation, coercion, over-parameterisation.`, r`One opinionated company chart encoding defaults for all services.`, r`Lint, render, validate, policy-check and diff in CI.`],
  ex: r`A shared standard-service chart brought PDBs, NetworkPolicies and restricted securityContext to 30 services in one quarter, versus months of per-team manifest edits.`,
  fu: [r`How do you upgrade CRDs safely when a chart ships them?`, r`Why avoid Helm hooks for database migrations?`],
  pit: [r`Assuming helm rollback reverts schema changes.`, r`Charts exposing every Kubernetes field as a value.`, r`Secrets committed in values files.`] },

{ id: 'q17', level: 'Intermediate', tags: ['graceful-shutdown', 'zero-downtime', 'dotnet', 'prestop'],
  q: r`Why do pods return errors during deployments even with readiness probes, and how do you implement truly graceful shutdown for an ASP.NET Core service and a queue consumer on Kubernetes?`,
  a: r`**The termination sequence** (happening concurrently, not in order):
1. Pod marked {{Terminating}}; it is removed from **EndpointSlices**.
2. In parallel, the kubelet runs the **preStop** hook, then sends **SIGTERM**.
3. After {{terminationGracePeriodSeconds}} (default 30 s) from the start, **SIGKILL**.

**The race**: endpoint removal must propagate to every node's kube-proxy/eBPF, to ingress controllers, load balancers and service-mesh proxies — this takes from milliseconds to several seconds. If the app stops accepting connections immediately on SIGTERM, requests still routed to it fail (502/connection refused). Readiness probes do not help: the pod is already out of endpoints in the API, but not yet everywhere.

**Fix for HTTP services**
- **preStop sleep** (for example 10-15 s; native {{sleep}} action in recent versions, or {{sleep}} command) — the pod keeps serving while routing updates propagate.
- Then SIGTERM: ASP.NET Core's host triggers {{ApplicationStopping}}, Kestrel stops accepting new connections and drains in-flight requests within {{HostOptions.ShutdownTimeout}}.
- Budget: preStop (15 s) + ShutdownTimeout (20 s) < terminationGracePeriodSeconds (45 s).
- Long-lived connections (HTTP/2, gRPC streams, WebSockets): send GOAWAY / close gracefully so clients reconnect elsewhere.
- Behind a cloud load balancer, align its deregistration delay with these numbers.

**Queue consumers**
- On cancellation, **stop fetching** new messages, finish or abandon the current one (so the broker redelivers promptly), commit offsets/acks, then exit.
- Use {{BackgroundService}} with the stopping token; keep handlers idempotent because a SIGKILL mid-message causes redelivery.

**Also**: PodDisruptionBudgets for drains, {{maxUnavailable: 0}} rollouts, and enough replicas that removing one does not overload the rest.`,
  code: r`~~~yaml
spec:
  terminationGracePeriodSeconds: 45
  containers:
    - name: api
      lifecycle:
        preStop:
          sleep: { seconds: 15 }          # keep serving while endpoint removal propagates
~~~
~~~csharp
builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(20)); // 15 + 20 < 45

public sealed class SettlementConsumer(IConsumer<string, string> consumer, IHandler handler) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) => Task.Run(async () =>
    {
        consumer.Subscribe("payments.captured");
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                var result = consumer.Consume(stoppingToken);        // throws OperationCanceledException on shutdown
                await handler.HandleAsync(result.Message, CancellationToken.None); // finish the in-flight message
                consumer.StoreOffset(result);
            }
        }
        catch (OperationCanceledException) { }
        finally { consumer.Close(); }                                 // commits stored offsets, leaves the group cleanly
    }, stoppingToken);
}
~~~`,
  dia: r`sequenceDiagram
  participant API as API server
  participant EP as kube-proxy / ingress / LB
  participant K as kubelet
  participant P as Pod (.NET)
  API->>EP: endpoint removed (propagates over seconds)
  API->>K: pod terminating
  K->>P: preStop sleep 15s - still serving
  K->>P: SIGTERM
  P->>P: ApplicationStopping, Kestrel drains, consumers stop
  P-->>K: exit within ShutdownTimeout
  Note over K,P: SIGKILL only after terminationGracePeriodSeconds`,
  pts: [r`Endpoint removal and SIGTERM happen concurrently; propagation takes seconds.`, r`A preStop sleep keeps serving during propagation.`, r`Kestrel drains on SIGTERM within ShutdownTimeout; budget below the grace period.`, r`Consumers stop fetching, finish or release the current message, commit, exit.`, r`Align load balancer deregistration, PDBs and maxUnavailable.`],
  ex: r`A payments API returned about 0.3% 502s on every deploy; a 15-second preStop sleep and a 20-second ShutdownTimeout under a 45-second grace period brought deploy errors to zero.`,
  fu: [r`How do gRPC streaming connections affect graceful shutdown?`, r`What happens if the grace period is shorter than preStop plus drain time?`],
  pit: [r`Relying on readiness probes to prevent deploy errors.`, r`Shutdown budget longer than terminationGracePeriodSeconds.`, r`Consumers that keep fetching after SIGTERM.`] },

{ id: 'q18', level: 'Intermediate', tags: ['observability', 'prometheus', 'logging', 'opentelemetry'],
  q: r`Design observability for a Kubernetes platform and its .NET workloads: metrics (Prometheus, kube-state-metrics), logs, traces with the OpenTelemetry Collector, events, and what you alert on.`,
  a: r`**Metrics**
- **Prometheus** (or a managed service: Amazon Managed Prometheus, Azure Monitor managed Prometheus, Grafana Cloud) scraping via ServiceMonitor/PodMonitor (Prometheus Operator).
- Sources: **cAdvisor/kubelet** (container CPU, memory, throttling), **kube-state-metrics** (object state: desired vs available replicas, pod restarts, Pending pods, Job failures), **node-exporter** (node resources), control-plane metrics (API server latency and errors), application metrics (.NET {{System.Diagnostics.Metrics}} exported via OpenTelemetry: request rate, errors, latency histograms, GC, thread pool).
- Watch **cardinality**: labels like user id or full URL explode series counts and cost.

**Logs**: apps write structured JSON to stdout; a **DaemonSet** (Fluent Bit, Vector, OTel Collector) tails container logs and enriches them with Kubernetes metadata (namespace, pod, labels) before shipping to Loki/Elasticsearch/CloudWatch/Log Analytics. Set retention per stream; never log secrets or PANs.

**Traces**: OpenTelemetry SDK in each service → **OpenTelemetry Collector** (agent DaemonSet and/or gateway Deployment) for batching, sampling (tail-based in the gateway), attribute scrubbing and export to Tempo/Jaeger/X-Ray/Application Insights. Propagate W3C {{traceparent}} through HTTP and message headers.

**Events**: Kubernetes events (scheduling failures, OOMKills, probe failures, image pull errors) expire after about an hour — export them (event exporter) for incident analysis.

**Alerting: symptoms first**
- Service SLOs: error rate and latency burn rates per user-facing service.
- Workload health: Deployment replicas unavailable, pods restarting/CrashLooping, Pending pods beyond N minutes, Job failures, HPA at max replicas.
- Saturation: CPU throttling, memory near limits (OOM risk), PVC usage, node pressure, conntrack table usage.
- Platform: API server error rate/latency, etcd health, certificate expiry, admission webhook latency/failures, CoreDNS errors.
Every alert has an owner and a runbook link; route by namespace ownership labels.`,
  code: r`~~~yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata: { name: workload-alerts, namespace: observability }
spec:
  groups:
    - name: workloads
      rules:
        - alert: DeploymentReplicasUnavailable
          expr: kube_deployment_status_replicas_unavailable{namespace=~"payments|cards"} > 0
          for: 10m
          labels: { severity: page }
          annotations: { runbook_url: "https://runbooks.internal/k8s/replicas-unavailable" }
        - alert: PodCrashLooping
          expr: increase(kube_pod_container_status_restarts_total[15m]) > 3
          for: 5m
          labels: { severity: ticket }
        - alert: PaymentsErrorBudgetBurn
          expr: |
            sum(rate(http_server_request_duration_seconds_count{service="payments-api",http_response_status_code=~"5.."}[5m]))
              / sum(rate(http_server_request_duration_seconds_count{service="payments-api"}[5m])) > 14.4 * 0.001
          for: 5m
          labels: { severity: page }
~~~`,
  dia: r`flowchart LR
  APP[.NET pods: OTel SDK] -->|OTLP| AG[OTel Collector agent - DaemonSet]
  AG --> GWC[OTel gateway: tail sampling, scrubbing]
  GWC --> TR[Tracing backend]
  APP -->|stdout JSON| FB[Fluent Bit DaemonSet] --> LOG[Log store]
  PROM[Prometheus] -->|scrape| APP
  PROM -->|scrape| KSM[kube-state-metrics, cAdvisor, node-exporter]
  PROM --> AM[Alertmanager: SLO burn, workload, saturation] --> PD[On-call]
  EVX[Event exporter] --> LOG`,
  pts: [r`Prometheus with kube-state-metrics, cAdvisor, node-exporter and app metrics; control cardinality.`, r`Structured stdout logs shipped by a DaemonSet with Kubernetes metadata.`, r`OpenTelemetry SDK plus Collector for traces, sampling and scrubbing.`, r`Export Kubernetes events; they expire quickly.`, r`Alert on SLO burn, workload health, saturation and platform components, with runbooks.`],
  ex: r`An incident review couldn't explain a 20-minute outage because Kubernetes events had expired; exporting events to the log store showed a node OOM cascade in the next incident within minutes.`,
  fu: [r`How do you keep Prometheus cardinality under control in a multi-tenant cluster?`, r`Where would you do tail-based sampling and why?`],
  pit: [r`High-cardinality labels such as user ids.`, r`Alerting on pod CPU instead of user-facing symptoms.`, r`Not exporting Kubernetes events.`] },

{ id: 'q19', level: 'Senior', tags: ['admission-control', 'policy', 'kyverno', 'validatingadmissionpolicy'],
  q: r`Explain admission control: mutating and validating webhooks, ValidatingAdmissionPolicy with CEL, and policy engines like Kyverno and Gatekeeper. Which policies would you enforce, and how do you avoid admission becoming a cluster-wide outage risk?`,
  a: r`**Admission chain**: authenticated, authorised requests pass through **mutating admission** (can change the object: inject sidecars, default labels, set securityContext) and then **validating admission** (accept or reject) before being stored. Built-in plugins include LimitRanger, ResourceQuota and Pod Security Admission.

**Extension options**
- **Webhooks** (MutatingWebhookConfiguration / ValidatingWebhookConfiguration): the API server calls your HTTPS service. Flexible, but it is a **network dependency in the write path** of the API server.
- **ValidatingAdmissionPolicy** (GA in 1.30): **CEL expressions evaluated in-process** by the API server — no webhook to run, no network hop, low latency; parameters via CRDs. Mutating admission policies with CEL are following.
- **Kyverno** (YAML policies; validate, mutate, generate, verify images) and **OPA Gatekeeper** (Rego constraint templates) — rich policy engines with audit reports; both run as webhooks.

**Policies worth enforcing**
- Images only from approved registries, **by digest**, with **verified signatures** (cosign/Notation) and attestations.
- Required labels (owner, cost-center, data-classification) and resource requests/limits.
- No {{latest}} tags, no privileged/host namespaces (beyond PSA), no {{NodePort}}/{{LoadBalancer}} Services outside approved namespaces, Ingress/HTTPRoute hostnames restricted per team.
- Mutations: default securityContext, topology spread, standard annotations.

**Avoiding outages (webhooks are a classic cause of full-cluster incidents)**
- {{failurePolicy}}: {{Fail}} for security-critical policies, {{Ignore}} for non-critical; understand the trade-off (Fail = webhook down blocks deploys).
- **Exclude system namespaces** ({{kube-system}}, the webhook's own namespace) with {{namespaceSelector}}/{{objectSelector}}; otherwise a webhook that is down can prevent its own pods from restarting (deadlock).
- Short {{timeoutSeconds}} (for example 2-5 s), multiple replicas with a PDB and anti-affinity, priority class, resource requests.
- Match only the resources and operations you need ({{rules}}), not {{*}}.
- Prefer ValidatingAdmissionPolicy for simple rules (no availability dependency).
- Monitor admission latency and rejections ({{apiserver_admission_webhook_*}} metrics); roll out in audit/warn mode first.`,
  code: r`~~~yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata: { name: images-by-digest-from-approved-registry }
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - { apiGroups: ["apps"], apiVersions: ["v1"], operations: ["CREATE", "UPDATE"], resources: ["deployments", "statefulsets"] }
  validations:
    - expression: >-
        object.spec.template.spec.containers.all(c,
          c.image.startsWith('registry.example/') && c.image.contains('@sha256:'))
      message: "Images must come from registry.example and be pinned by digest."
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata: { name: images-by-digest-binding }
spec:
  policyName: images-by-digest-from-approved-registry
  validationActions: [Deny]                        # start with [Warn, Audit] during rollout
  matchResources:
    namespaceSelector:
      matchExpressions: [ { key: kubernetes.io/metadata.name, operator: NotIn, values: [kube-system, platform-system] } ]
~~~`,
  dia: r`flowchart LR
  REQ[API request] --> AUTH[authn + RBAC]
  AUTH --> MUT[Mutating admission: defaults, sidecar injection]
  MUT --> SCH[Schema validation]
  SCH --> VAP[ValidatingAdmissionPolicy - CEL in-process]
  VAP --> WH[Validating webhooks: Kyverno signature checks - timeout 3s]
  WH --> ETCD[(etcd)]
  WH -.webhook down + failurePolicy Fail.-> BLOCK[Writes blocked]`,
  pts: [r`Mutating then validating admission before persistence.`, r`ValidatingAdmissionPolicy runs CEL in-process: no network dependency.`, r`Kyverno/Gatekeeper for rich policies, including image signature verification.`, r`Enforce registries, digests, signatures, labels, resources and network exposure rules.`, r`Webhooks: scoped rules, exclude system namespaces, short timeouts, HA, monitored, audit first.`],
  ex: r`A policy webhook with failurePolicy Fail and no namespace exclusions went down during a node upgrade and blocked its own pods from rescheduling; the cluster could not deploy anything for 70 minutes.`,
  fu: [r`Fail or Ignore for an image-signature policy, and why?`, r`How do you test policies against existing workloads before enforcing them?`],
  pit: [r`Webhooks matching all resources including kube-system.`, r`Long webhook timeouts.`, r`Enforcing new policies without an audit phase.`] },

{ id: 'q20', level: 'Senior', tags: ['crds', 'operators', 'controllers', 'reconciliation'],
  q: r`Explain CRDs and the operator pattern: how a controller reconciles, idempotency, status and conditions, finalizers and owner references. When should a team write an operator, and when is it a mistake?`,
  a: r`**CRD**: extends the API with a new resource type (schema via OpenAPI v3, versioning, validation with CEL rules). By itself it only stores objects.

**Controller/operator**: a process that **watches** resources and **reconciles** actual state towards desired state. An operator encodes operational knowledge (how to provision, upgrade, back up, fail over a system) as code.

**Reconcile loop essentials**
- Driven by **watches** through informers with a local cache; requests are queued by key (namespace/name), with rate-limited retries.
- **Level-based and idempotent**: the reconcile function must produce the same result whether it runs once or ten times, and must not assume which event triggered it (events can be coalesced or missed).
- Read desired state from {{spec}}; observe the world; create/update owned objects; write **{{status}}** with **conditions** ({{Ready}}, {{Progressing}}, {{Degraded}}) and {{observedGeneration}} so users and tools know whether the latest spec has been processed.
- **Owner references** make child objects garbage-collected with the parent.
- **Finalizers** block deletion until cleanup of external resources (a cloud database, DNS record) is done — and must be removed when cleanup completes, or objects hang in {{Terminating}} forever.
- Handle conflicts with optimistic concurrency ({{resourceVersion}}), requeue on transient errors with backoff, use leader election for HA.

**When to write one**
- You run a complex stateful system repeatedly (dozens of instances) with real operational procedures to automate.
- You build a platform abstraction ({{PaymentService}} CRD that expands into Deployment, HPA, PDB, NetworkPolicy, alerts, database).

**When it is a mistake**
- A Helm chart or Kustomize would do (static templating).
- The team cannot support a long-lived controller: upgrades, API version migrations (conversion webhooks), RBAC, on-call for reconcile bugs that can delete production resources.
- An existing mature operator exists (CloudNativePG, Strimzi, cert-manager, External Secrets) or managed services make it unnecessary.
- Crossplane or Kro-style composition can express it without custom code.

**Building**: Kubebuilder/controller-runtime (Go) is the mainstream; .NET options exist (KubeOps) but the ecosystem is thinner.`,
  code: r`~~~csharp
// Reconcile logic (illustrative, KubeOps-style): idempotent, status-driven, finalizer for external cleanup
public async Task ReconcileAsync(PaymentService ps, CancellationToken ct)
{
    if (ps.Metadata.DeletionTimestamp is not null)
    {
        await _db.DropDatabaseIfExistsAsync(ps.Spec.DatabaseName, ct);        // external cleanup (idempotent)
        await _k8s.RemoveFinalizerAsync(ps, "payments.example.com/db-cleanup", ct);
        return;
    }
    await _k8s.EnsureFinalizerAsync(ps, "payments.example.com/db-cleanup", ct);

    await _db.EnsureDatabaseAsync(ps.Spec.DatabaseName, ct);                  // create if missing, no-op otherwise
    await _k8s.ApplyAsync(BuildDeployment(ps), owner: ps, ct);                // server-side apply, owner reference set
    await _k8s.ApplyAsync(BuildPdb(ps), owner: ps, ct);

    var ready = await _k8s.IsDeploymentAvailableAsync(ps.Name(), ps.Namespace(), ct);
    await _k8s.UpdateStatusAsync(ps, s =>
    {
        s.ObservedGeneration = ps.Metadata.Generation;
        s.SetCondition("Ready", ready ? "True" : "False", ready ? "Available" : "Progressing");
    }, ct);
}
~~~`,
  dia: r`flowchart LR
  CR[PaymentService CR: spec] -->|watch| CTRL[Operator - informer cache, work queue]
  CTRL -->|reconcile, idempotent| DEP[Deployment]
  CTRL --> PDB[PDB, HPA, NetworkPolicy]
  CTRL --> EXT[External DB]
  CTRL -->|status, conditions, observedGeneration| CR
  DEP -.ownerReference GC.-> CR`,
  pts: [r`CRDs store new types; controllers make them do something.`, r`Reconcile is level-based, idempotent and event-agnostic.`, r`Report status with conditions and observedGeneration.`, r`Owner references for garbage collection; finalizers for external cleanup, always removed.`, r`Write operators only for real repeated operational complexity you can support.`],
  ex: r`A team's homegrown operator had a reconcile bug that deleted Services when the spec omitted a field; rewriting it to server-side apply with owned fields and adding dry-run tests ended the incidents.`,
  fu: [r`How do you version a CRD from v1alpha1 to v1 without breaking users?`, r`What causes objects stuck in Terminating?`],
  pit: [r`Non-idempotent reconcile logic.`, r`Finalizers never removed.`, r`Writing an operator where a chart would do.`] },

{ id: 'q21', level: 'Senior', tags: ['gitops', 'argo-cd', 'flux', 'promotion'],
  q: r`Implement GitOps with Argo CD or Flux: the pull model, repository structure, environment promotion, drift and self-healing, secrets, and how it satisfies change-management auditors.`,
  a: r`**Principles** (OpenGitOps): desired state is **declarative**, **versioned and immutable** in Git, **pulled** automatically by agents in the cluster, and **continuously reconciled**.

**Pull vs push**: CI no longer needs cluster credentials. CI builds, tests, signs and publishes images and updates a manifest/values file (commit or PR); the in-cluster controller pulls and applies. Cluster API access stays internal.

**Repository structure** (one common shape)
- App source repos produce images.
- A **config repo** (or per-team config repos): {{apps/<service>/base}} + {{overlays/<env>}} or Helm values per environment; {{platform/}} for cluster add-ons.
- Argo CD **ApplicationSets** generate Applications per cluster/environment; "app of apps" for bootstrap.

**Promotion**: change the image digest in {{dev}}, then a PR (often automated by Kargo/Argo CD Image Updater/Renovate) promotes the **same digest** to {{staging}} and {{prod}}. Promotion is a Git change with review — not a rebuild.

**Drift and self-heal**: the controller detects live changes that differ from Git; with **self-heal** it reverts them. Combine with read-only human access to production so the only change path is Git. Use **sync waves/hooks** for ordering (CRDs before CRs, migrations before apps) and **sync windows** to restrict prod changes to approved periods.

**Secrets**: never plaintext in Git. Options: External Secrets Operator (Git holds a reference, the value lives in Vault/Secrets Manager/Key Vault), Sealed Secrets or SOPS (encrypted in Git, decrypted in cluster).

**Auditors**: every production change is a reviewed Git commit (who, what, when, approval), signed commits optional, the controller's sync history ties commits to cluster state, rollback = revert commit. Segregation of duties: authors cannot approve their own prod PRs (branch protection).

**Pitfalls**: Argo CD itself becomes a critical system (HA, RBAC, SSO, backups of its config); huge monorepos slow reconciliation; manual {{kubectl}} hotfixes get reverted unless backported to Git; Helm hooks and CRD ordering need care.`,
  code: r`~~~yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata: { name: payments-api, namespace: argocd }
spec:
  generators:
    - list:
        elements:
          - { env: dev,  cluster: https://dev.k8s.internal }
          - { env: prod, cluster: https://prod-weu.k8s.internal }
  template:
    metadata: { name: "payments-api-{{env}}" }
    spec:
      project: payments
      source:
        repoURL: https://git.example/platform/config.git
        targetRevision: main
        path: "apps/payments-api/overlays/{{env}}"
      destination: { server: "{{cluster}}", namespace: payments }
      syncPolicy:
        automated: { prune: true, selfHeal: true }
        syncOptions: [ServerSideApply=true]
~~~
~~~bash
# Promotion = a reviewed change of the image digest in the prod overlay
cd apps/payments-api/overlays/prod && kustomize edit set image registry.example/payments-api@sha256:9c1e...
git commit -am "promote payments-api 9c1e... to prod (tested in staging run #4821)" && git push origin promote/payments-api
~~~`,
  dia: r`flowchart LR
  DEV[Developer PR] --> CI[CI: build, test, sign image]
  CI -->|bump digest in dev overlay| CFG[(Config repo)]
  CFG -->|promotion PR, reviewed| CFG
  ARGO1[Argo CD - dev cluster] -->|pull + reconcile| CFG
  ARGO2[Argo CD - prod cluster] -->|pull + reconcile, self-heal| CFG
  HUMAN[kubectl edit in prod] -.reverted.-> ARGO2`,
  pts: [r`Declarative, versioned, pulled, continuously reconciled.`, r`CI needs no cluster credentials; the controller pulls.`, r`Promote the same digest through environments via reviewed Git changes.`, r`Self-heal reverts drift; read-only humans in prod; sync waves and windows.`, r`External secrets or encrypted secrets; Git history is the audit trail.`],
  ex: r`A bank's SOX audit of Kubernetes changes became a query over Git history and Argo CD sync records; the previous process needed screenshots from three tools.`,
  fu: [r`How do you handle an emergency hotfix under GitOps?`, r`How do you order CRD installation before custom resources?`],
  pit: [r`Plaintext secrets in the config repo.`, r`Manual hotfixes that are silently reverted.`, r`Rebuilding images per environment.`] },

{ id: 'q22', level: 'Senior', tags: ['progressive-delivery', 'canary', 'argo-rollouts', 'blue-green'],
  q: r`Implement progressive delivery on Kubernetes: canary and blue/green with Argo Rollouts or Flagger, metric-based analysis and automatic rollback, and handling database and message-schema changes.`,
  a: r`**Why**: a rolling update replaces pods but has no concept of "is the new version healthy for users?" Progressive delivery shifts traffic gradually and **decides automatically** based on metrics.

**Strategies**
- **Canary**: send 5% → 25% → 50% → 100% of traffic to the new version with pauses, analysing metrics at each step.
- **Blue/green**: run the full new version alongside, test via a preview Service, switch all traffic at once, keep blue for instant rollback.
- **Traffic splitting** needs a router that supports weights: Gateway API HTTPRoute weights, a service mesh (Istio, Linkerd), or an ingress controller. Without one, canaries fall back to replica ratios (coarse).

**Analysis**: an **AnalysisTemplate** queries Prometheus/Datadog/CloudWatch for the canary's success rate and p99 latency compared with thresholds (or with the baseline). Failure → automatic **abort and rollback** of traffic. Include business metrics where possible (authorisation approval rate — a buggy release can return 200 OK while declining everything).

**Tools**: **Argo Rollouts** (a Rollout CRD replacing the Deployment; integrates with Argo CD) or **Flagger** (works with existing Deployments; integrates with Flux and meshes).

**Data and schema changes** — the real constraint
- During a canary, **both versions run concurrently** and may run for hours. Database changes must be **expand/contract**: add columns/tables first (compatible with old code), deploy code that writes both/reads new, backfill, then remove old structures in a later release.
- Never run destructive migrations in a pre-sync hook of a canary.
- Message schemas: consumers must tolerate both old and new versions (additive changes, schema registry compatibility rules); producers upgrade after consumers.
- Feature flags decouple deploy from release for risky business logic.

**Operational details**: canary pods need enough replicas to produce statistically meaningful metrics; low-traffic services may need synthetic traffic or longer steps; header-based routing lets testers reach the canary first.`,
  code: r`~~~yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata: { name: payments-api, namespace: payments }
spec:
  replicas: 10
  selector: { matchLabels: { app: payments-api } }
  template: { metadata: { labels: { app: payments-api } }, spec: { containers: [ { name: api, image: "registry.example/payments-api@sha256:9c1e..." } ] } }
  strategy:
    canary:
      canaryService: payments-api-canary
      stableService: payments-api-stable
      trafficRouting:
        plugins: { argoproj-labs/gatewayAPI: { httpRoute: payments, namespace: payments } }
      steps:
        - setWeight: 5
        - analysis: { templates: [ { templateName: payments-health } ] }
        - setWeight: 25
        - pause: { duration: 10m }
        - setWeight: 50
        - analysis: { templates: [ { templateName: payments-health } ] }
---
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata: { name: payments-health, namespace: payments }
spec:
  metrics:
    - name: success-rate
      interval: 1m
      count: 5
      failureLimit: 1
      successCondition: result[0] >= 0.995
      provider:
        prometheus:
          address: http://prometheus.observability:9090
          query: |
            sum(rate(http_server_request_duration_seconds_count{service="payments-api-canary",http_response_status_code!~"5.."}[2m]))
            / sum(rate(http_server_request_duration_seconds_count{service="payments-api-canary"}[2m]))
~~~`,
  dia: r`flowchart LR
  GW[Gateway HTTPRoute weights] -->|95| STABLE[stable ReplicaSet]
  GW -->|5| CANARY[canary ReplicaSet]
  CANARY --> PROM[Prometheus]
  PROM --> AN{Analysis: success rate, p99, approval rate}
  AN -->|pass| STEP[Increase weight 25, 50, 100]
  AN -->|fail| RB[Abort: weight 0, rollback]`,
  pts: [r`Rolling updates do not judge user impact; progressive delivery does.`, r`Canary with weighted routing; blue/green with preview and instant switch.`, r`Automated analysis on technical and business metrics with automatic abort.`, r`Expand/contract schema changes and tolerant message consumers.`, r`Low-traffic services need longer steps or synthetic traffic.`],
  ex: r`A canary of a card-authorisation change passed HTTP error checks but the analysis on approval rate dropped from 94% to 81%; Argo Rollouts aborted at 5% traffic, limiting impact to a few minutes of a small slice.`,
  fu: [r`How do you canary a queue consumer rather than an HTTP service?`, r`What if a migration cannot be made backward compatible?`],
  pit: [r`Destructive migrations during a canary.`, r`Analysis only on HTTP status codes.`, r`Canary steps too short for meaningful data.`] },

{ id: 'q23', level: 'Senior', tags: ['service-mesh', 'istio', 'ambient', 'mtls'],
  q: r`Service mesh on Kubernetes: what Istio (sidecar and ambient) and Linkerd provide, the real costs, mTLS identity, and how you decide whether a mesh is worth it.`,
  a: r`**What a mesh provides**
- **mTLS** between workloads with automatic certificate issuance and rotation, using **SPIFFE identities** derived from service accounts ({{spiffe://cluster.local/ns/payments/sa/payments-api}}).
- **L7 authorisation policies**: "only ledger-service may call POST /postings".
- **Traffic management**: retries, timeouts, circuit breaking/outlier detection, weighted routing, mirroring, fault injection.
- **Telemetry**: consistent request metrics and traces for every hop without app changes.

**Data planes**
- **Sidecar** (classic Istio, Linkerd's Rust micro-proxy): a proxy in every pod. Full L7 features per pod, but memory/CPU per replica, injection complexity, startup ordering (solved by native sidecars) and upgrade churn (restarting pods to upgrade proxies).
- **Istio ambient mode** (GA in late 2024): a per-node **ztunnel** provides L4 mTLS and identity; optional **waypoint proxies** per namespace/service provide L7 only where needed. Much lower overhead and no sidecar injection, at the cost of a newer, different architecture.
- **Cilium** offers mesh features with eBPF and per-node Envoy.

**Costs to be honest about**
- Resource overhead (sidecars: tens to 100+ MB per pod × thousands of pods), added latency per hop (typically sub-millisecond to a few ms).
- Operational complexity: control-plane upgrades, CRD sprawl, debugging through proxies, certificate authority management.
- **Retry amplification**: mesh retries stacked on application (Polly) retries multiply load during incidents — choose one layer.

**Decision framework**
- **Yes** when you need workload identity and mTLS across many services for regulatory reasons (zero trust, PCI segmentation), uniform L7 policy, and multi-team traffic management — and have a platform team to run it.
- **Maybe not** for a handful of services: TLS via the app or CNI encryption (WireGuard), NetworkPolicy for L3/4, OpenTelemetry for telemetry, and resilience in code may suffice.
- Start with ambient or Linkerd for lower overhead if mTLS + telemetry are the main goals; add L7 where justified.`,
  code: r`~~~yaml
# Istio: strict mTLS in the namespace and L7 authorisation for the ledger API
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata: { name: default, namespace: payments }
spec: { mtls: { mode: STRICT } }
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata: { name: ledger-postings, namespace: payments }
spec:
  selector: { matchLabels: { app: ledger } }
  action: ALLOW
  rules:
    - from: [ { source: { principals: ["cluster.local/ns/payments/sa/payments-api"] } } ]
      to:   [ { operation: { methods: ["POST"], paths: ["/v1/postings"] } } ]
---
# Ambient mode: enrol the namespace (no sidecars); add a waypoint only where L7 policy is needed
apiVersion: v1
kind: Namespace
metadata: { name: payments, labels: { istio.io/dataplane-mode: ambient } }
~~~`,
  dia: r`flowchart LR
  subgraph NodeA[Node A]
    P1[payments-api pod] --> ZT1[ztunnel - L4 mTLS]
  end
  subgraph NodeB[Node B]
    ZT2[ztunnel] --> L1[ledger pod]
  end
  ZT1 -->|HBONE mTLS, SPIFFE identity| WP[Waypoint proxy - L7 authz for ledger]
  WP --> ZT2
  CP[istiod: certificates, config] -.-> ZT1
  CP -.-> WP`,
  pts: [r`Mesh = mTLS identity, L7 policy, traffic management, uniform telemetry.`, r`Sidecars give full L7 per pod at resource and upgrade cost; ambient splits L4 ztunnel and optional L7 waypoints.`, r`Watch retry amplification between mesh and app.`, r`Justify by regulatory identity/mTLS needs and team capacity.`, r`Alternatives: CNI encryption, NetworkPolicy, OpenTelemetry, in-code resilience.`],
  ex: r`A payments platform needed provable service-to-service authentication for PCI; Istio ambient gave strict mTLS across 120 services with about a fifth of the memory overhead its sidecar pilot had measured.`,
  fu: [r`How would you migrate from sidecar to ambient mode?`, r`Where should retries live: mesh or application?`],
  pit: [r`Adopting a mesh for telemetry alone.`, r`Double retries in mesh and code.`, r`Permissive mTLS left on indefinitely.`] },

{ id: 'q24', level: 'Senior', tags: ['secrets-management', 'external-secrets', 'csi', 'rotation'],
  q: r`Manage secrets for 200 services across clusters: External Secrets Operator versus the Secrets Store CSI driver versus Sealed Secrets/SOPS, workload identity to remove secrets, rotation, and audit.`,
  a: r`**First, remove secrets**: use **workload identity** (IRSA/EKS Pod Identity, Azure workload identity, GKE Workload Identity) for cloud resources, and IAM/Entra database authentication where supported. The best secret is one that does not exist.

**For secrets that must exist** (PSP API keys, third-party credentials, TLS keys):
| Option | How it works | Pros | Cons |
|---|---|---|---|
| **External Secrets Operator (ESO)** | {{ExternalSecret}} CR references a key in Vault/Secrets Manager/Key Vault; ESO syncs it into a Kubernetes Secret and refreshes | apps consume normal Secrets/env; Git holds references only; refresh intervals | the value still lands in etcd (encrypt with KMS) |
| **Secrets Store CSI driver** | mounts secrets as files directly from the store at pod start; optional sync to Secret | can avoid etcd entirely; per-pod identity fetch | values fixed per mount unless rotation enabled; pod start depends on store availability |
| **Sealed Secrets / SOPS** | encrypted secrets committed to Git, decrypted in cluster | pure GitOps, no external store | rotation and revocation are manual; key management of the sealing key |

Common enterprise choice: **ESO with a central store** (Vault or cloud secret manager), workload identity for ESO's access, KMS encryption at rest in etcd, and RBAC preventing humans from reading Secrets in prod.

**Rotation**
- The store rotates (Secrets Manager rotation Lambda, Vault dynamic credentials with leases).
- ESO refreshes ({{refreshInterval}}); the app must pick up the new value: file-based reload, or trigger a rollout (Reloader-style controller watching Secret changes).
- **Dual credentials** during rotation (old and new both valid) to avoid outages; Vault **dynamic secrets** issue per-pod short-lived DB credentials.

**Audit and blast radius**: per-service paths in the store with per-service identities (payments cannot read cards' secrets); store audit logs; Kubernetes audit logs for Secret reads; alert on unusual access; secret scanning in CI to catch leaks.`,
  code: r`~~~yaml
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata: { name: aws-secrets-manager }
spec:
  provider:
    aws:
      service: SecretsManager
      region: eu-west-1
      auth: { jwt: { serviceAccountRef: { name: external-secrets, namespace: external-secrets } } }   # IRSA / Pod Identity
---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata: { name: psp-credentials, namespace: payments }
spec:
  refreshInterval: 15m
  secretStoreRef: { kind: ClusterSecretStore, name: aws-secrets-manager }
  target: { name: psp-credentials, creationPolicy: Owner }
  data:
    - secretKey: apiKey
      remoteRef: { key: prod/payments/psp, property: apiKey }
~~~`,
  dia: r`flowchart LR
  STORE[(Secrets Manager / Vault - rotation)] -->|ESO via workload identity| ESO[External Secrets Operator]
  ESO -->|sync every 15 min| SEC[Kubernetes Secret - etcd KMS encrypted]
  SEC -->|volume| POD[payments-api]
  RL[Reloader] -.secret changed: rollout.-> POD
  GIT[Git: ExternalSecret reference only] --> ESO
  POD -->|workload identity, no secret| CLOUD[Cloud DB / queues]`,
  pts: [r`Eliminate secrets with workload identity first.`, r`ESO syncs from a central store; CSI mounts directly; Sealed Secrets/SOPS keep encrypted values in Git.`, r`Encrypt etcd with KMS and restrict Secret reads.`, r`Rotation needs store rotation, refresh and app reload with dual credentials.`, r`Per-service paths and identities; audit logs and leak scanning.`],
  ex: r`A PSP credential leaked in a log; because ESO synced from Secrets Manager with 15-minute refresh and apps reloaded on change, rotation across 14 clusters took 20 minutes instead of a weekend.`,
  fu: [r`How do Vault dynamic database credentials change the rotation story?`, r`What happens to pods if the secret store is down at start-up?`],
  pit: [r`Secrets copied manually into each cluster.`, r`Rotation without app reload, causing outages.`, r`One identity able to read every secret.`] },

{ id: 'q25', level: 'Senior', tags: ['multi-tenancy', 'namespaces', 'quotas', 'isolation'],
  q: r`Design multi-tenancy on Kubernetes for many internal teams: namespaces, ResourceQuotas and LimitRanges, RBAC, NetworkPolicies, node isolation — and when to choose virtual clusters or separate clusters instead.`,
  a: r`**Soft multi-tenancy (trusted internal teams) with namespaces**
- **Namespace per team per environment** (or per service), created by automation with a standard bundle:
  - **RBAC**: team groups bound to namespace roles (q13).
  - **ResourceQuota**: caps total CPU/memory requests and limits, number of pods, Services of type LoadBalancer, PVC storage — stops one team consuming the cluster.
  - **LimitRange**: default requests/limits for containers that omit them, min/max per container — prevents BestEffort pods.
  - **NetworkPolicies**: default deny plus allowed flows (q12).
  - **Pod Security Admission** labels (restricted).
  - Labels for ownership and cost allocation.
- **Hierarchical namespaces** or a namespace-as-a-service controller (Capsule) to let teams self-serve within limits.

**What namespaces do not isolate**: the kernel and nodes (a container escape reaches co-located pods), cluster-scoped resources (CRDs, ClusterRoles, admission webhooks, StorageClasses), API server capacity (one team's controller can overload it — API Priority and Fairness helps), and noisy neighbours on shared nodes (CPU caches, disk and network I/O).

**Stronger isolation options**
- **Dedicated node pools** per tenant class (taints + affinity) — for PCI workloads or noisy workloads.
- **Sandboxed runtimes** (gVisor, Kata Containers) for untrusted code.
- **Virtual clusters** (vcluster): each tenant gets its own API server and control plane objects running inside a host namespace — tenants can install CRDs and have cluster-admin in their virtual cluster while sharing nodes. Good for dev/test environments, CI ephemeral clusters, platform teams' sandboxes.
- **Separate clusters**: hard isolation for regulatory scope (CDE), very different upgrade cadences, untrusted tenants (external customers), or blast-radius limits. Cost: more control planes, add-ons and operational overhead — manage as a fleet.

**Decision**: internal trusted teams → namespaces with guardrails; teams needing cluster-scoped control → virtual clusters; regulatory boundaries or hostile tenants → separate clusters (and possibly separate accounts/subscriptions).`,
  code: r`~~~yaml
apiVersion: v1
kind: ResourceQuota
metadata: { name: team-quota, namespace: cards-prod }
spec:
  hard:
    requests.cpu: "40"
    requests.memory: 80Gi
    limits.memory: 80Gi
    pods: "200"
    services.loadbalancers: "0"           # exposure only via the shared Gateway
    requests.storage: 500Gi
---
apiVersion: v1
kind: LimitRange
metadata: { name: defaults, namespace: cards-prod }
spec:
  limits:
    - type: Container
      defaultRequest: { cpu: 100m, memory: 256Mi }
      default:        { memory: 256Mi }
      max:            { cpu: "4", memory: 8Gi }
~~~`,
  dia: r`flowchart TB
  subgraph CLUSTER[Shared cluster]
    NS1[ns payments-prod: RBAC, quota, limits, netpol, PSA restricted]
    NS2[ns cards-prod: same bundle]
    VC[vcluster: platform-sandbox - own API server]
  end
  POOL1[Node pool: general] --- NS2
  POOL2[Node pool: payments - tainted] --- NS1
  CDE[Separate CDE cluster - own account] -.hard isolation.-> CLUSTER`,
  pts: [r`Namespace per team with RBAC, quota, LimitRange, NetworkPolicy and PSA by automation.`, r`Namespaces do not isolate kernels, cluster-scoped resources or API capacity.`, r`Dedicated node pools and sandboxed runtimes add isolation.`, r`Virtual clusters for tenants needing cluster-scoped control.`, r`Separate clusters for regulatory scope or untrusted tenants.`],
  ex: r`A shared cluster without quotas went down when one team's runaway Job created 8,000 pods; namespace quotas and LimitRanges in the namespace bootstrap prevented a repeat.`,
  fu: [r`How does API Priority and Fairness protect a shared API server?`, r`When would you give a team a vcluster rather than a namespace?`],
  pit: [r`Treating namespaces as security boundaries against hostile tenants.`, r`No quotas or default limits.`, r`Letting tenants install cluster-wide webhooks or CRDs in a shared cluster.`] },

{ id: 'q26', level: 'Senior', tags: ['cluster-autoscaler', 'karpenter', 'node-scaling', 'consolidation'],
  q: r`Node autoscaling: Cluster Autoscaler versus Karpenter, how scale-up and scale-down decisions work, bin packing and consolidation, Spot capacity, and why pods stay Pending.`,
  a: r`**Cluster Autoscaler (CA)**: watches **unschedulable pods**, simulates scheduling against configured **node groups** (ASGs, VMSS, managed node pools) and increases the group's size; scales down nodes whose pods can move elsewhere and that are under-utilised for a period. Constraints: you predefine node groups (instance types, zones); multi-zone spreading often needs one group per zone; scale-up time = cloud instance launch + node bootstrap + image pull (typically 1-4 minutes).

**Karpenter** (AWS-originated, now also behind AKS node autoprovisioning): watches pending pods and **provisions right-sized instances directly** from a broad set of instance types that satisfy pod requirements (CPU, memory, architecture, zone, capacity type), without node groups. Features: **consolidation** (replace or remove nodes to reduce cost), **drift** detection (replace nodes whose config/AMI changed — used for upgrades), Spot interruption handling, disruption budgets.

**Bin packing and consolidation**: autoscalers pack by **requests**, not usage. Inflated requests waste nodes; deflated requests cause noisy neighbours and OOMs. Consolidation moves pods to fewer nodes — it is a voluntary disruption, so **PDBs** and **do-not-disrupt** annotations matter, and frequent consolidation can churn caches and connections.

**Spot/preemptible capacity**: up to 60-90% cheaper but reclaimable with short notice (2 minutes on AWS). Use for stateless, replicated, interruption-tolerant workloads; diversify instance types; handle termination notices (drain); keep a baseline of on-demand for critical services.

**Why pods stay Pending**
- Requests larger than any allowed instance type, or exceeding quotas.
- Constraints impossible to satisfy (node selectors, taints, topology spread with DoNotSchedule, zonal PVC in a zone with no capacity).
- Cloud capacity shortage for the instance type/zone; account limits.
- Autoscaler max size reached; IP exhaustion in subnets (VPC CNI).
- {{kubectl describe pod}} events ("0/12 nodes are available: 3 Insufficient cpu, 9 node(s) had untolerated taint") and autoscaler logs/events tell you which.

**Speeding up**: overprovisioning with low-priority placeholder pods (they get preempted instantly, buying time while new nodes launch), smaller images, pre-pulled base images, warm pools.`,
  code: r`~~~yaml
# Overprovisioning: low-priority "balloon" pods reserve headroom; real pods preempt them instantly
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata: { name: overprovisioning }
value: -10
globalDefault: false
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: capacity-reservation, namespace: platform-system }
spec:
  replicas: 3
  selector: { matchLabels: { app: capacity-reservation } }
  template:
    metadata: { labels: { app: capacity-reservation } }
    spec:
      priorityClassName: overprovisioning
      terminationGracePeriodSeconds: 0
      containers:
        - name: pause
          image: registry.k8s.io/pause:3.10
          resources: { requests: { cpu: "2", memory: 4Gi } }
~~~
~~~bash
kubectl describe pod payments-api-7c9d-x2k -n payments | sed -n '/Events/,$p'   # why Pending?
kubectl get events -A --field-selector reason=FailedScheduling
~~~`,
  dia: r`flowchart LR
  PEND[Pending pods] --> KP[Karpenter: choose instance types meeting requirements]
  KP --> EC2[Launch on-demand or Spot node in needed zone]
  EC2 --> SCHED[Scheduler binds pods]
  KP -->|consolidation, respects PDBs| SHRINK[Remove or replace under-used nodes]
  BAL[Balloon pods - negative priority] -.preempted instantly.-> SCHED`,
  pts: [r`Cluster Autoscaler scales predefined node groups; Karpenter provisions right-sized nodes directly.`, r`Packing is by requests: right-size requests or waste money.`, r`Consolidation is voluntary disruption: PDBs and annotations matter.`, r`Spot for interruption-tolerant replicated workloads with diversification.`, r`Read FailedScheduling events to explain Pending; balloon pods buy headroom.`],
  ex: r`Moving from four fixed node groups to Karpenter with Spot for workers and consolidation cut a cluster's compute bill by 38%; PDBs on payments services kept consolidation from disrupting peak traffic.`,
  fu: [r`How do you stop consolidation from disrupting latency-sensitive services?`, r`Why does a zonal PVC sometimes block scale-up?`],
  pit: [r`Running critical singletons on Spot.`, r`Inflated requests causing idle nodes.`, r`Ignoring subnet IP limits as a scale-up blocker.`] },

{ id: 'q27', level: 'Senior', tags: ['pdb', 'disruptions', 'drains', 'availability'],
  q: r`PodDisruptionBudgets: voluntary versus involuntary disruptions, how drains and the eviction API use PDBs, configuring them correctly, and how a bad PDB blocks node upgrades.`,
  a: r`**Disruptions**
- **Involuntary**: node hardware failure, kernel panic, cloud instance termination, OOM, network partition. PDBs **cannot** prevent these — only replicas and spreading help.
- **Voluntary**: node drains for upgrades or scale-down, consolidation, cluster autoscaler removals, manual {{kubectl drain}}. These go through the **Eviction API**, which honours PDBs.

**PDB**: {{minAvailable}} or {{maxUnavailable}} (absolute or percentage) for pods matching a selector. The eviction API refuses (HTTP 429) an eviction that would violate the budget; drains retry until it is allowed.

**Configuring correctly**
- Prefer {{maxUnavailable: 1}} (or a percentage) — it scales with replica count and always allows progress if pods are healthy.
- Ensure **replicas > minAvailable**: a Deployment with 2 replicas and {{minAvailable: 2}} can never be evicted.
- Account for unhealthy pods: by default, pods that are not Ready still count against the budget; {{unhealthyPodEvictionPolicy: AlwaysAllow}} lets drains evict pods that are already broken (otherwise a CrashLooping pod can block a drain forever).
- One PDB per workload; overlapping selectors produce confusing results.
- Singletons (1 replica) with a PDB of {{minAvailable: 1}} block every drain — either accept disruption ({{maxUnavailable: 1}}) or run more replicas.

**How bad PDBs block upgrades**: managed node-group upgrades drain nodes; a PDB that allows zero disruptions makes the drain hang until the provider's timeout — then some providers **force-delete** pods anyway (losing the protection) or fail the upgrade. Karpenter/CA scale-down also stalls, wasting money.

**Operational practice**: policy that every multi-replica production workload has a PDB with {{maxUnavailable}} ≥ 1; alerts for PDBs with {{disruptionsAllowed == 0}} for long periods; drains in maintenance windows with surge capacity; topology spread so a single node drain only touches one replica.`,
  code: r`~~~yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: payments-api, namespace: payments }
spec:
  maxUnavailable: 1                          # always allows progress when pods are healthy
  unhealthyPodEvictionPolicy: AlwaysAllow    # broken pods do not block drains
  selector: { matchLabels: { app: payments-api } }
~~~
~~~text
# PromQL: PDBs that have allowed zero disruptions for an hour (will block upgrades)
kube_poddisruptionbudget_status_pod_disruptions_allowed == 0
  and on (namespace, poddisruptionbudget)
  (time() - kube_poddisruptionbudget_created) > 3600
~~~`,
  dia: r`sequenceDiagram
  participant D as Drain / Karpenter
  participant E as Eviction API
  participant P as PDB payments-api
  D->>E: evict pod A
  E->>P: disruptionsAllowed?
  P-->>E: 1
  E-->>D: evicted
  D->>E: evict pod B
  E->>P: disruptionsAllowed?
  P-->>E: 0 until A's replacement is Ready
  E-->>D: 429, retry later`,
  pts: [r`PDBs govern voluntary disruptions via the Eviction API, not failures.`, r`Prefer maxUnavailable; ensure replicas exceed minAvailable.`, r`unhealthyPodEvictionPolicy AlwaysAllow stops broken pods blocking drains.`, r`Zero-disruption PDBs stall upgrades and scale-down.`, r`Alert on PDBs with zero allowed disruptions.`],
  ex: r`A cluster upgrade stalled for six hours because a two-replica service had minAvailable 2; switching the platform default to maxUnavailable 1 unblocked upgrades across 80 services.`,
  fu: [r`Does a PDB protect against a node crash?`, r`How should singletons be handled during drains?`],
  pit: [r`minAvailable equal to replicas.`, r`PDBs on single-replica workloads.`, r`Expecting PDBs to prevent involuntary disruptions.`] },

{ id: 'q28', level: 'Senior', tags: ['upgrades', 'version-skew', 'deprecations', 'lifecycle'],
  q: r`Plan Kubernetes cluster upgrades: release cadence and support windows, version skew rules, deprecated APIs, upgrade order, in-place versus blue/green clusters, and keeping a fleet current.`,
  a: r`**Cadence**: about **three minor releases per year**; each minor gets roughly **14 months** of upstream patch support. Managed providers have their own windows (standard support around 12-14 months, then paid extended support on EKS/AKS LTS options). Falling behind means a forced, risky multi-version catch-up.

**Version skew policy** (key facts)
- Control-plane components: API servers in an HA set within one minor of each other.
- **kubelet** may be up to **three minors older** than the API server (never newer).
- kubectl within one minor of the API server.
- Upgrade **one minor version at a time** for the control plane (1.31 → 1.32 → 1.33).

**Deprecated and removed APIs**: removed API versions (for example {{extensions/v1beta1}} Ingress, {{policy/v1beta1}} PodSecurityPolicy) break manifests, Helm releases and operators. Before upgrading: scan manifests and live objects (pluto, kubent, provider upgrade insights), check the API server's deprecated-API request metrics ({{apiserver_requested_deprecated_apis}}), upgrade Helm charts/operators/CRDs first, fix Helm release metadata that references removed APIs.

**Upgrade order**
1. Read release notes and provider notes; check add-on compatibility (CNI, CSI, CoreDNS, kube-proxy, ingress/gateway, mesh, policy engine, autoscaler, monitoring agents).
2. Upgrade in non-production first; run conformance and application smoke tests.
3. Control plane → add-ons → node pools (surge upgrades or Karpenter drift replacement, respecting PDBs).
4. Validate workloads, alerts and dashboards; then proceed to the next environment.

**In-place vs blue/green clusters**
- **In-place**: cheaper, standard for minor upgrades on managed services.
- **Blue/green clusters**: build a new cluster on the target version (via IaC + GitOps bootstrap), move traffic gradually (DNS/Gateway weights), keep the old one for rollback. Safer for big jumps, CNI changes or major add-on changes; needs stateless workloads or a data migration plan.

**Fleet practice**: cluster definitions as code, GitOps for add-ons with version pinning, an upgrade calendar (every quarter), canary clusters, automated pre-flight checks, and an "N-1 at worst" policy.`,
  code: r`~~~bash
# Pre-flight: find deprecated/removed API usage before upgrading to the next minor
pluto detect-all-in-cluster --target-versions k8s=v1.33.0 -o wide
kubectl get --raw /metrics | grep apiserver_requested_deprecated_apis
# EKS example: control plane first, then add-ons, then node groups / Karpenter drift
aws eks update-cluster-version --name prod-weu --kubernetes-version 1.33
aws eks update-addon --cluster-name prod-weu --addon-name vpc-cni --addon-version <compatible-version>
kubectl get nodes -L karpenter.sh/nodepool -o wide     # watch drifted nodes being replaced respecting PDBs
~~~`,
  dia: r`flowchart LR
  N[Non-prod cluster upgraded + tests] --> CP[Prod control plane +1 minor]
  CP --> AD[Add-ons: CNI, CSI, CoreDNS, gateway, mesh, policy]
  AD --> NP[Node pools: surge / Karpenter drift, PDB-aware]
  NP --> V[Validate SLOs, alerts]
  V -->|big change| BG[Alternative: blue/green cluster + traffic shift]`,
  pts: [r`Three minors a year, ~14 months support; do not fall behind.`, r`kubelet up to three minors older than the API server; control plane one minor at a time.`, r`Scan for removed APIs and upgrade charts, operators and CRDs first.`, r`Order: control plane, add-ons, nodes; test in non-prod.`, r`Blue/green clusters for risky jumps; fleet upgrade calendar as code.`],
  ex: r`A bank three versions behind had to upgrade under end-of-support pressure; 140 manifests used removed APIs. After catching up it moved to a quarterly upgrade calendar with pluto checks in CI.`,
  fu: [r`What breaks if kubelets are newer than the API server?`, r`How do you upgrade a cluster running stateful operators?`],
  pit: [r`Skipping minor versions on the control plane.`, r`Upgrading before upgrading add-ons and CRDs.`, r`Letting clusters drift into extended support.`] },

{ id: 'q29', level: 'Senior', tags: ['troubleshooting', 'crashloopbackoff', 'pending', 'oomkilled'],
  q: r`Give your troubleshooting playbook for CrashLoopBackOff, ImagePullBackOff, Pending, OOMKilled, Evicted, and a Service that returns connection refused. Which commands and signals do you use for each?`,
  a: r`**General order**: {{kubectl get}} (status) → {{kubectl describe}} (events, conditions) → logs (current and {{--previous}}) → metrics → node-level and network checks.

| Symptom | Typical causes | First checks |
|---|---|---|
| **CrashLoopBackOff** | app exits on start (bad config, missing secret, failed migration, unhandled exception), liveness killing it, wrong command/entrypoint | {{kubectl logs --previous}}, {{describe}} for exit code (1 = app error, 137 = SIGKILL/OOM, 139 = segfault), probe events |
| **ImagePullBackOff / ErrImagePull** | wrong tag/digest, private registry auth (imagePullSecrets, node/IRSA permissions), registry rate limits, architecture mismatch (arm64 vs amd64), network to registry | {{describe}} events with the registry error message |
| **Pending** | insufficient resources, taints/affinity/topology unsatisfiable, PVC unbound or zonal, quota exceeded, autoscaler max | {{describe pod}} FailedScheduling message, {{get pvc}}, quota usage, autoscaler events |
| **OOMKilled** | memory limit too low, leak, unbounded caches, large payloads; .NET heap limit vs native memory | {{describe}} last state reason OOMKilled exit 137, memory metrics vs limit, dotnet-counters/gcdump |
| **Evicted** | node pressure (memory, disk/ephemeral storage, PIDs) — pods above requests evicted first | {{describe}} message ("The node was low on resource: ephemeral-storage"), node conditions, log volume or emptyDir growth |
| **Service connection refused / timeouts** | selector does not match pod labels, wrong targetPort, pods not Ready (no endpoints), NetworkPolicy blocking, app listening on 127.0.0.1 instead of 0.0.0.0 | {{kubectl get endpointslices -l kubernetes.io/service-name=X}}, {{describe svc}}, test from a debug pod, check netpol |

**Tools**
- {{kubectl debug}} with **ephemeral containers** to attach a debug image (netshoot, dotnet tools) to a running distroless pod, or {{kubectl debug node/...}} for node-level inspection.
- {{kubectl events}} / exported events, {{kubectl top}}, Prometheus dashboards, CNI flow logs (Hubble).
- For .NET: {{dotnet-counters}}, {{dotnet-trace}}, {{dotnet-dump}} via an ephemeral container sharing the process namespace.

**Discipline**: change one thing at a time, capture evidence (events expire), and fix the cause, not the symptom (raising a limit can mask a leak).`,
  code: r`~~~bash
kubectl get pods -n payments -o wide
kubectl describe pod payments-api-6f7d9-abcde -n payments | sed -n '/State:/,/Events:/p;/Events:/,$p'
kubectl logs payments-api-6f7d9-abcde -n payments --previous --tail=100
kubectl get endpointslices -n payments -l kubernetes.io/service-name=payments-api -o wide
# Attach a debug container (with .NET diagnostic tools) to a distroless pod, sharing its process namespace
kubectl debug -it payments-api-6f7d9-abcde -n payments --image=registry.example/dotnet-debug:8.0 \
  --target=api -- dotnet-counters monitor --process-id 1 System.Runtime
~~~`,
  dia: r`flowchart TD
  S[Pod unhealthy] --> G[kubectl get: status]
  G -->|CrashLoopBackOff| L[logs --previous, exit code, probe events]
  G -->|ImagePullBackOff| I[describe: registry error, auth, arch]
  G -->|Pending| P[describe: FailedScheduling, PVC, quota]
  G -->|OOMKilled 137| M[memory vs limit, dotnet-gcdump]
  G -->|Evicted| N[node pressure: disk, memory, PIDs]
  G -->|Running but unreachable| E[endpointslices, selector, targetPort, netpol, bind address]`,
  pts: [r`get → describe → logs (--previous) → metrics → node/network.`, r`Exit codes: 1 app error, 137 SIGKILL/OOM, 139 segfault.`, r`Pending is explained by FailedScheduling events.`, r`Unreachable Services: endpoints, selectors, targetPort, NetworkPolicy, bind address.`, r`kubectl debug with ephemeral containers for distroless .NET pods.`],
  ex: r`A new .NET 8 image crash-looped in production only; logs --previous showed it listening on port 8080 while the Service targeted 80 — the default port changed with the base image upgrade.`,
  fu: [r`How do you debug a distroless container without a shell?`, r`Why might a pod be Evicted while its memory is below its limit?`],
  pit: [r`Looking at current logs instead of --previous for crash loops.`, r`Raising memory limits to hide a leak.`, r`Ignoring the .NET 8 default port change to 8080.`] },

{ id: 'q30', level: 'Senior', tags: ['incident', '502', 'deployments', 'endpoints'],
  q: r`Incident: during every deployment and node scale-down, about 1% of requests to a payments API fail with 502/503 from the ingress, although readiness probes and rolling updates are configured. Investigate and fix end to end.`,
  a: r`**Hypothesis**: requests are routed to pods that are terminating or not yet ready to serve, because routing updates lag behind pod lifecycle events.

**Investigation**
1. Correlate errors with rollout and scale-down events (Kubernetes events, Argo CD sync times, Karpenter consolidation logs) — confirm the timing.
2. Ingress/gateway logs: upstream status ({{upstream connect error}}, {{connection refused}}, {{reset}}), which pod IPs failed — were they in Terminating state?
3. Check the app's shutdown behaviour: does it stop listening immediately on SIGTERM? Is there a preStop? What is {{terminationGracePeriodSeconds}} vs drain time?
4. Check **keep-alive** settings: the ingress keeps upstream connections pooled; if the app closes idle connections sooner than the proxy expects, or the proxy reuses a connection the app just closed, you get 502s (classic Node/Kestrel vs ALB/NGINX keep-alive mismatch).
5. Check readiness on startup: does the new pod accept traffic before warm-up (JIT, caches, connection pools)?
6. For cloud load balancers targeting pods directly (IP mode): deregistration delay vs grace period; LB health-check interval.

**Fixes**
- **preStop sleep** (10-20 s) so the pod keeps serving while endpoint removal propagates to the ingress and LBs (q17).
- Graceful drain in Kestrel within the budget; grace period ≥ preStop + drain.
- Keep-alive: app idle timeout **longer** than the proxy's upstream keep-alive timeout ({{KestrelServerOptions.Limits.KeepAliveTimeout}}).
- Readiness gated on warm-up; {{minReadySeconds}}; startup probe.
- Retries at the ingress for **idempotent** requests on connection errors only (never blindly retry POST /payments without idempotency keys).
- **Pod readiness gates** for cloud LB controllers so pods count as ready only once registered in the LB target group.
- PDBs and {{maxUnavailable: 0}} rollouts; consolidation disruption budgets during business hours.

**Verify**: run a load test during rollouts and node drains with a success-rate threshold in CI (zero errors as the acceptance criterion); add an SLO alert for errors during deploy windows.`,
  code: r`~~~csharp
// Kestrel keep-alive must outlive the proxy's upstream idle timeout (e.g. NGINX/Envoy 60 s, ALB 60 s)
builder.WebHost.ConfigureKestrel(k =>
{
    k.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(75);
    k.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(30);
});
builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(20));
~~~
~~~yaml
spec:
  minReadySeconds: 10
  strategy: { rollingUpdate: { maxSurge: 25%, maxUnavailable: 0 } }
  template:
    spec:
      terminationGracePeriodSeconds: 45
      readinessGates: [ { conditionType: target-health.elbv2.k8s.aws/payments-tg } ]   # AWS LB Controller readiness gate
      containers:
        - name: api
          lifecycle: { preStop: { sleep: { seconds: 15 } } }
~~~`,
  dia: r`sequenceDiagram
  participant IG as Ingress / LB
  participant API as API server
  participant P as Old pod
  API->>P: Terminating (SIGTERM after preStop)
  API->>IG: endpoint removed - arrives seconds later
  IG->>P: request in the gap
  alt no preStop sleep
    P-->>IG: connection refused -> 502
  else preStop 15s
    P-->>IG: 200 OK, still serving
  end`,
  pts: [r`Errors come from routing lag during termination and early traffic on cold pods.`, r`Check ingress upstream errors and pod states at failure time.`, r`preStop sleep, graceful drain, correct grace period.`, r`Align keep-alive timeouts: app longer than proxy.`, r`Readiness gates, warm-up, safe retries for idempotent requests, load tests during rollouts.`],
  ex: r`A card platform cut deploy-time errors from 1.1% to zero with a 15-second preStop, Kestrel keep-alive at 75 seconds versus the ALB's 60, and AWS LB Controller readiness gates.`,
  fu: [r`Why can keep-alive mismatches produce 502s even without deployments?`, r`When is it unsafe to retry at the ingress?`],
  pit: [r`Assuming readiness probes cover termination.`, r`App keep-alive shorter than the proxy's.`, r`Retrying non-idempotent payment requests at the proxy.`] },

{ id: 'q31', level: 'Senior', tags: ['incident', 'dns', 'coredns', 'ndots'],
  q: r`Incident: random 5-second latency spikes on outbound calls from pods, worse under load. You suspect DNS. Explain ndots and search domains, the conntrack race, CoreDNS scaling, NodeLocal DNSCache, and how .NET resolves names.`,
  a: r`**Why DNS is a frequent culprit**
- Pod {{resolv.conf}}: {{search <ns>.svc.cluster.local svc.cluster.local cluster.local <cloud domains>}} and **{{options ndots:5}}**. Any name with fewer than 5 dots is first tried with each search suffix. {{api.psp.example}} (2 dots) triggers up to 4-6 queries (A and AAAA each) that fail before the real lookup — multiplying CoreDNS load.
- **The 5-second spike signature**: a lost UDP DNS packet waits for the resolver's default **5-second timeout** before retry. A known Linux **conntrack race** when A and AAAA queries are sent in parallel from the same socket can drop one of them under load.
- CoreDNS pods saturated (CPU throttling, too few replicas), or upstream resolver limits (cloud resolvers have per-interface packet limits, for example AWS's ~1,024 packets/s per ENI).

**Investigation**
- Latency histograms of outbound calls show clusters at ~5 s; CoreDNS metrics ({{coredns_dns_request_duration_seconds}}, error/servfail rates, cache hit ratio), CPU throttling on CoreDNS pods.
- From a debug pod: {{dig}} with timings, count queries for an external name; tcpdump on the node for retransmits; conntrack insert-failure counters.

**Fixes**
1. **NodeLocal DNSCache**: a caching DNS agent on each node (DaemonSet); pods query a link-local IP, avoiding conntrack for UDP to CoreDNS and cutting latency and load. The standard fix for the conntrack race.
2. Reduce search-path amplification: use **fully qualified names with a trailing dot** for external hosts ({{api.psp.example.}}), or set {{dnsConfig}} with {{ndots: 2}} for workloads that mostly call external names.
3. Scale CoreDNS (cluster-proportional autoscaler), give it adequate CPU requests and no tight limits, enable caching, spread across nodes/zones.
4. Resolver options: {{single-request-reopen}} (glibc) where applicable; use TCP fallback.

**.NET specifics**: {{HttpClient}}/{{SocketsHttpHandler}} resolves through the OS resolver (glibc {{getaddrinfo}} on Linux containers); .NET does not cache DNS itself beyond the connection lifetime. Long-lived pooled connections avoid repeated lookups; {{PooledConnectionLifetime}} (for example 2-5 minutes) re-resolves periodically to follow DNS changes without per-request lookups. Chiseled/Alpine images: musl's resolver behaves differently (no {{single-request-reopen}}, different search handling) — another reason to test DNS behaviour on the exact base image.`,
  code: r`~~~yaml
# Workload that mostly calls external APIs: fewer search-path expansions
spec:
  dnsConfig:
    options:
      - { name: ndots, value: "2" }
      - { name: single-request-reopen }
  containers:
    - name: psp-adapter
      env:
        - { name: Psp__BaseUrl, value: "https://api.psp.example./" }   # trailing dot = fully qualified, no search suffixes
~~~
~~~bash
# From a debug pod: count lookups and spot the 5 s timeouts
kubectl run dnsdebug --rm -it --image=nicolaka/netshoot -n payments -- bash -c \
  'for i in $(seq 1 50); do dig +stats api.psp.example | grep "Query time"; done | sort | uniq -c'
~~~`,
  dia: r`flowchart LR
  POD[Pod: ndots 5] -->|api.psp.example| Q1[payments.svc.cluster.local - NXDOMAIN]
  Q1 --> Q2[svc.cluster.local - NXDOMAIN]
  Q2 --> Q3[cluster.local - NXDOMAIN]
  Q3 --> Q4[real lookup]
  POD2[Pod] -->|link-local IP| NLD[NodeLocal DNSCache on node]
  NLD -->|cache miss, TCP| CDNS[CoreDNS]
  CDNS --> UP[Upstream resolver]`,
  pts: [r`ndots:5 multiplies lookups for external names.`, r`5-second spikes = lost UDP packet plus resolver timeout; conntrack race on parallel A/AAAA.`, r`NodeLocal DNSCache is the standard fix; scale and tune CoreDNS.`, r`Use trailing-dot FQDNs or lower ndots for external-heavy workloads.`, r`.NET relies on the OS resolver; pooled connections with PooledConnectionLifetime limit lookups.`],
  ex: r`A PSP adapter showed p99 of 5.1 s at peak; NodeLocal DNSCache plus trailing-dot hostnames cut DNS queries per call from 10 to 2 and removed the spikes.`,
  fu: [r`Why does musl behave differently from glibc for DNS in containers?`, r`How does PooledConnectionLifetime interact with DNS failover?`],
  pit: [r`Blaming the downstream API for 5-second spikes.`, r`Tight CPU limits on CoreDNS.`, r`Creating HttpClient per request, forcing a lookup each time.`] },

{ id: 'q32', level: 'Senior', tags: ['incident', 'cpu-throttling', 'thread-pool', 'latency'],
  q: r`Incident: a .NET API on Kubernetes shows p99 latency rising from 80 ms to 1.5 s at moderate load, average CPU only 40% of its limit, and occasional timeouts calling Redis. Diagnose and fix.`,
  a: r`**Two interacting suspects**: CFS CPU throttling and .NET thread-pool starvation.

**1. CPU throttling**
- With a 1-CPU limit and 4+ busy threads, the container exhausts its 100 ms quota early in each period and is frozen for the rest — requests stall in bursts while the **average** stays at 40%.
- Evidence: {{container_cpu_cfs_throttled_periods_total / container_cpu_cfs_periods_total}} at 30-50%; latency spikes aligned with throttling; GC pauses lengthened (Server GC threads also throttled).

**2. Thread-pool starvation**
- Sync-over-async ({{.Result}}, {{.Wait()}}, synchronous Redis/HTTP calls) blocks thread-pool threads; the pool injects new threads slowly (roughly one or two per second once past the minimum), so queued work waits.
- The StackExchange.Redis timeout message shows it: {{IOCP: (Busy=0,Free=1000,Min=4,Max=1000), WORKER: (Busy=58,Free=32709,Min=4,Max=32767)}} — Busy far above Min means starvation. **Min=4** reflects {{ProcessorCount}} derived from the CPU limit.
- Evidence: {{dotnet-counters}} — {{threadpool-queue-length}} growing, {{threadpool-thread-count}} climbing slowly; a dump showing many threads blocked in {{Task.Wait}}.

**Fixes (root cause first)**
1. Remove blocking calls on hot paths (async all the way); check libraries and filters added in the recent change.
2. Revisit CPU limits: remove the limit (keep a realistic request) or raise it; for latency-sensitive services throttling is usually worse than noisy-neighbour risk. Set requests to cover p95 usage.
3. GC configuration for the container: with small CPU counts consider Workstation or Server GC with DATAS (.NET 9 default), or {{DOTNET_GCHeapCount}}; avoid huge allocations per request.
4. As a temporary mitigation only: raise {{ThreadPool.SetMinThreads}} — buys time, hides the bug.
5. Redis client: async APIs, singleton multiplexer, sensible timeouts.

**Prevention**: alerts on throttling ratio and thread-pool queue length, load tests with production-like CPU limits, analyzers against sync-over-async (VSTHRD002, CA2012-style rules), and dashboards correlating latency with throttling.`,
  code: r`~~~csharp
// Before: synchronous Redis and blocking on async inside a request
public IActionResult GetLimits(string accountId)
{
    var cached = _redis.GetDatabase().StringGet($"limits:{accountId}");     // sync network call
    var limits = cached.HasValue ? Parse(cached!) : _repo.GetLimitsAsync(accountId).Result; // blocks a pool thread
    return Ok(limits);
}

// After: async end to end
public async Task<IActionResult> GetLimits(string accountId, CancellationToken ct)
{
    var cached = await _redis.GetDatabase().StringGetAsync($"limits:{accountId}");
    var limits = cached.HasValue ? Parse(cached!) : await _repo.GetLimitsAsync(accountId, ct);
    return Ok(limits);
}
~~~
~~~bash
kubectl debug -it payments-api-6f7d9-abcde -n payments --image=registry.example/dotnet-debug:8.0 --target=api -- \
  dotnet-counters monitor -p 1 --counters System.Runtime[threadpool-queue-length,threadpool-thread-count,cpu-usage]
~~~`,
  dia: r`flowchart TD
  L[p99 1.5 s, avg CPU 40 percent] --> T{Throttled periods high?}
  T -->|yes| CPU[CFS throttling: remove or raise CPU limit, right-size request]
  L --> TP{Thread-pool queue growing, Busy above Min?}
  TP -->|yes| SYNC[Sync-over-async: fix code path]
  CPU --> OK[Latency recovers]
  SYNC --> OK`,
  pts: [r`Average CPU hides CFS throttling; check throttled-period ratio.`, r`Redis timeout messages expose thread-pool starvation (Busy vs Min).`, r`ProcessorCount from the CPU limit sets thread-pool minimums.`, r`Fix blocking code first; revisit CPU limits; tune GC for small containers.`, r`Raising MinThreads is a mitigation, not a fix.`],
  ex: r`A limits API at 40% average CPU had 45% throttled periods and sync Redis calls; async calls plus removing the CPU limit took p99 from 1.5 s to 70 ms.`,
  fu: [r`Why does a CPU limit of 1 make starvation worse in .NET?`, r`Should all CPU limits be removed?`],
  pit: [r`Diagnosing from average CPU.`, r`Raising MinThreads permanently.`, r`Blaming Redis for client-side starvation.`] },

{ id: 'q33', level: 'Senior', tags: ['etcd', 'raft', 'control-plane', 'backup'],
  q: r`Explain etcd's role and behaviour: Raft quorum, why cluster sizes are odd, performance sensitivities, object size and database limits, backup and restore — and what you see when etcd is unhealthy.`,
  a: r`**Role**: etcd stores all cluster state; the API server is its only client. Every write (pod status updates, leases, events) is a Raft-replicated write.

**Raft and quorum**: a leader replicates log entries to followers; a write commits when a **majority** acknowledges. Cluster of 3 tolerates 1 failure, 5 tolerates 2. Even sizes add no tolerance (4 still tolerates 1) and add latency; members are spread across zones. Losing quorum makes etcd **read-only/unavailable** → the API server cannot write: no scheduling, no scaling, no deployments — but **existing pods keep running** (data plane continues).

**Performance sensitivities**
- **Disk fsync latency** is critical (WAL writes): slow disks cause leader elections and API latency. Use fast SSDs dedicated to etcd; monitor {{etcd_disk_wal_fsync_duration_seconds}} (p99 should be ~10 ms or less).
- Network latency between members (keep within a region).
- Object churn: frequent updates (events, leases, status updates from noisy controllers) and large lists (unpaginated LISTs of all pods across a big cluster) load both etcd and the API server.

**Limits**: request/object size limit about **1.5 MiB** (large ConfigMaps/CRs fail); default backend **quota 2 GiB** (raise up to ~8 GiB recommended max); exceeding it raises a **NOSPACE alarm** and etcd stops accepting writes until compaction and defragmentation. Keep history compacted (the API server does periodic compaction) and defragment periodically.

**Backup and restore** (self-managed clusters; managed services handle etcd for you)
- {{etcdctl snapshot save}} regularly, encrypted, stored off-cluster; test restores.
- Restore rebuilds a cluster from the snapshot — all members restored from the same snapshot, then API servers restarted.
- Remember: an etcd snapshot captures the cluster at that point; objects created later are lost, and controllers then reconcile. **GitOps + external data backups** are usually the primary DR path; etcd snapshots are a fallback (q41).
- Secrets are inside the snapshot — encryption at rest (KMS) protects them only if the KMS key is separate.

**Unhealthy etcd symptoms**: API server timeouts and 5xx, {{etcdserver: request timed out}}, frequent leader changes, slow {{kubectl}}, controllers lagging (replicas not updating), alarms in etcd metrics.`,
  code: r`~~~bash
# Self-managed control plane: health, alarms, snapshot
ETCDCTL_API=3 etcdctl --endpoints=https://10.0.1.10:2379,https://10.0.2.10:2379,https://10.0.3.10:2379 \
  --cacert=/etc/etcd/ca.crt --cert=/etc/etcd/client.crt --key=/etc/etcd/client.key endpoint status -w table
etcdctl alarm list                                  # NOSPACE means writes are blocked
etcdctl snapshot save /backup/etcd-$(date +%F-%H%M).db && etcdctl snapshot status /backup/etcd-*.db -w table
~~~
~~~text
# PromQL: etcd disk health and leader stability
histogram_quantile(0.99, rate(etcd_disk_wal_fsync_duration_seconds_bucket[5m])) > 0.01
increase(etcd_server_leader_changes_seen_total[1h]) > 3
~~~`,
  dia: r`flowchart LR
  API1[API server] --> L[(etcd leader - zone a)]
  API2[API server] --> L
  L -->|replicate log| F1[(follower - zone b)]
  L -->|replicate log| F2[(follower - zone c)]
  F1 -.ack.-> L
  L -->|commit on majority 2 of 3| OK[Write durable]
  L --> SNAP[Encrypted snapshots off-cluster]`,
  pts: [r`etcd holds all state; the API server is the only client.`, r`Raft majority: 3 tolerates 1, 5 tolerates 2; even sizes add nothing.`, r`Disk fsync latency and object churn drive performance.`, r`~1.5 MiB object limit, 2 GiB default quota with NOSPACE alarm; compact and defrag.`, r`Snapshots are a fallback; GitOps plus data backups are primary DR.`],
  ex: r`A self-managed cluster hit etcd's 2 GiB quota from an operator writing status every second; writes stopped cluster-wide until compaction, defragmentation and an operator fix.`,
  fu: [r`What keeps working when etcd loses quorum?`, r`Why can a single noisy controller degrade the whole control plane?`],
  pit: [r`Running etcd on slow shared disks.`, r`Four-member etcd clusters.`, r`Untested snapshot restores.`] },

{ id: 'q34', level: 'Senior', tags: ['supply-chain', 'image-signing', 'sbom', 'admission'],
  q: r`Secure the container supply chain from commit to running pod: minimal images, scanning, SBOMs, signing and provenance (Sigstore/cosign, SLSA), registry controls, and admission-time verification.`,
  a: r`**Threats**: compromised dependencies, malicious base images, tampered build pipelines, pushing unreviewed images directly to the registry, and running images that no longer match what was tested.

**Controls along the chain**
1. **Source**: protected branches, reviews, signed commits optional, dependency pinning and update automation (Renovate/Dependabot), secret scanning.
2. **Build**: hermetic, ephemeral CI runners; build once; minimal base images (.NET **chiseled** Ubuntu images or distroless: no shell, no package manager, non-root by default) to cut CVEs and attack surface; multi-stage Dockerfiles.
3. **Scan**: image vulnerability scanning (Trivy/Grype, registry-native scanners) with policies on severity and fix availability; scan continuously after publication because new CVEs appear later.
4. **SBOM**: generate (Syft, {{dotnet}} SBOM tooling) in SPDX/CycloneDX and attach to the image as an attestation — answers "are we affected by CVE-X?" in minutes.
5. **Sign and attest**: **cosign** (Sigstore) keyless signing with the CI's OIDC identity, or keys in KMS; **SLSA provenance** attestation describing how and where it was built.
6. **Registry**: private registry, immutable tags, pull through cache for public images, replication across regions, retention policies; only CI can push.
7. **Deploy**: reference images **by digest**; admission policy (Kyverno verifyImages, Sigstore policy-controller, Gatekeeper + Ratify) **verifies signatures and attestations** from the expected identity (your CI workflow on the main branch) and rejects others.
8. **Runtime**: runtime detection (Falco), drift detection (unexpected binaries executed), and periodic re-scanning of running images.

**Organisational side**: a vulnerability management SLA (critical fixed within days), exception process, base image ownership (a platform team publishes golden base images weekly), and evidence for auditors (SBOMs, provenance, admission logs).`,
  code: r`~~~bash
# CI: build, SBOM, scan, keyless sign with the workflow's OIDC identity, attest provenance
docker build -t registry.example/payments-api:$GIT_SHA . && docker push registry.example/payments-api:$GIT_SHA
DIGEST=$(crane digest registry.example/payments-api:$GIT_SHA)
syft registry.example/payments-api@$DIGEST -o cyclonedx-json > sbom.json
trivy image --exit-code 1 --severity CRITICAL --ignore-unfixed registry.example/payments-api@$DIGEST
cosign sign --yes registry.example/payments-api@$DIGEST
cosign attest --yes --type cyclonedx --predicate sbom.json registry.example/payments-api@$DIGEST
~~~
~~~yaml
# Kyverno: only images signed by our main-branch CI workflow may run in payments
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata: { name: verify-payments-images }
spec:
  validationFailureAction: Enforce
  webhookTimeoutSeconds: 10
  rules:
    - name: verify-signature
      match: { any: [ { resources: { kinds: [Pod], namespaces: [payments] } } ] }
      verifyImages:
        - imageReferences: ["registry.example/*"]
          mutateDigest: true
          attestors:
            - entries:
                - keyless:
                    issuer: https://token.actions.githubusercontent.com
                    subject: "https://github.com/bank/payments-api/.github/workflows/build.yml@refs/heads/main"
~~~`,
  dia: r`flowchart LR
  SRC[Reviewed commit] --> CI[Ephemeral CI: build chiseled image]
  CI --> SBOM[SBOM + scan]
  SBOM --> SIGN[cosign keyless sign + SLSA provenance]
  SIGN --> REG[(Private registry - immutable, CI-only push)]
  REG -->|digest| ADM[Admission: verify signature + attestations]
  ADM -->|valid| POD[Pod runs]
  ADM -->|unsigned or wrong identity| REJ[Rejected]
  RT[Runtime detection + continuous re-scan] -.-> POD`,
  pts: [r`Minimal base images and build-once pipelines reduce attack surface.`, r`Scan at build and continuously; SBOMs answer exposure questions fast.`, r`Sign with cosign and attest provenance from CI identity.`, r`Registry: immutable tags, CI-only push, digests in manifests.`, r`Admission verifies signatures and attestations; runtime detection closes the loop.`],
  ex: r`When a critical OpenSSL CVE was announced, SBOM attestations let a bank list affected images across 600 workloads in 20 minutes; chiseled .NET images were largely unaffected.`,
  fu: [r`Keyless signing or KMS keys: what are the trade-offs?`, r`How do you handle a critical CVE with no fix available?`],
  pit: [r`Scanning only at build time.`, r`Mutable tags in production manifests.`, r`Signature checks that accept any signer.`] },

{ id: 'q35', level: 'Senior', tags: ['stateful', 'operators', 'kafka', 'postgres', 'managed-services'],
  q: r`Should you run Kafka and PostgreSQL on Kubernetes with operators (Strimzi, CloudNativePG) or use managed services (MSK/Confluent, RDS/Aurora/Azure PostgreSQL)? Give the decision framework and what running them well actually requires.`,
  a: r`**Managed services give you**: patched, monitored infrastructure, automated backups and PITR, tested failover, storage scaling, support contracts and compliance attestations — at a price premium and with less control (versions, configuration, extensions, network placement).

**Operators give you**: declarative clusters (a {{Kafka}} or {{Cluster}} CR), automated rolling upgrades, failover orchestration, backups to object storage, the same tooling everywhere (portability across clouds and on-premises), and potentially lower cost at scale.

**Decision framework**
| Factor | Lean managed | Lean operator on Kubernetes |
|---|---|---|
| Team expertise | no dedicated data/platform SREs | strong platform team with storage and DB expertise |
| Scale and cost | small/medium | large fleets where premium matters |
| Portability/sovereignty | single cloud acceptable | on-prem, multi-cloud, sovereign requirements |
| Compliance | need provider attestations quickly | can produce your own evidence |
| Criticality | core ledger, payments data | dev/test, ephemeral environments, secondary stores |
| Features | provider supports what you need | need extensions/configs providers block |

Typical answer for a bank: **managed for production systems of record**; operators for dev/test environments, ephemeral per-PR databases, and where on-prem or portability requirements apply.

**What running them well on Kubernetes requires**
- **Storage**: fast block storage, {{WaitForFirstConsumer}}, capacity monitoring and expansion, understanding of zonal failure (data replicated by the application — Postgres streaming replication, Kafka replication factor 3 across zones — not by Kubernetes).
- **Placement**: dedicated node pools, anti-affinity across zones, PDBs, no Spot, guaranteed QoS.
- **Backups and restores**: continuous WAL archiving to object storage (CloudNativePG/Barman), Kafka topic and offset backup strategy; **monthly restore drills** with measured RTO.
- **Upgrades**: operator upgrades, database major versions, Kafka KRaft migrations — rehearsed.
- **Observability and on-call**: replication lag, under-replicated partitions, disk, connection counts; runbooks; humans who understand the engine at 3 a.m.
- **Security**: TLS, authentication, network policies, secrets management, encryption at rest.`,
  code: r`~~~yaml
# CloudNativePG: 3 instances across zones, WAL archiving and scheduled backups to object storage
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata: { name: risk-pg, namespace: data }
spec:
  instances: 3
  imageName: ghcr.io/cloudnative-pg/postgresql:16.4
  storage: { size: 200Gi, storageClass: gp3-encrypted }
  affinity: { enablePodAntiAffinity: true, topologyKey: topology.kubernetes.io/zone, podAntiAffinityType: required }
  backup:
    retentionPolicy: "30d"
    barmanObjectStore:
      destinationPath: s3://bank-pg-backups/risk-pg
      s3Credentials: { inheritFromIAMRole: true }
      wal: { compression: gzip }
---
apiVersion: postgresql.cnpg.io/v1
kind: ScheduledBackup
metadata: { name: risk-pg-daily, namespace: data }
spec: { schedule: "0 0 2 * * *", cluster: { name: risk-pg } }
~~~`,
  dia: r`flowchart TD
  Q[Stateful system needed] --> C1{System of record for money?}
  C1 -->|yes| M[Managed service: RDS/Aurora, MSK/Confluent]
  C1 -->|no| C2{Strong platform team + portability or cost driver?}
  C2 -->|no| M
  C2 -->|yes| O[Operator on Kubernetes: CloudNativePG, Strimzi]
  O --> REQ[Requires: storage, placement, backups + drills, upgrades, on-call]`,
  pts: [r`Managed services trade cost and control for operations, backups and attestations.`, r`Operators give declarative, portable clusters but need real expertise.`, r`Decide on expertise, scale, portability, compliance and criticality.`, r`Replication by the engine across zones; Kubernetes does not replicate data.`, r`Backups with restore drills, upgrades and on-call are the real cost.`],
  ex: r`A bank ran Strimzi Kafka for analytics on-premises and Amazon MSK for payment events in the cloud; the split matched each workload's criticality and the platform team's capacity.`,
  fu: [r`How would you prove an operator-managed Postgres meets an RPO of 5 minutes?`, r`What changes with Kafka KRaft for operators?`],
  pit: [r`Assuming the operator replaces database expertise.`, r`Spot nodes or BestEffort pods for databases.`, r`Backups never restored in a drill.`] },

{ id: 'q36', level: 'Senior', tags: ['right-sizing', 'vpa', 'cost-allocation', 'capacity'],
  q: r`Right-size workloads across a large cluster: measuring actual usage, VPA recommendations, overcommit ratios, quotas, and allocating cost to teams with OpenCost/Kubecost. How do you get teams to act?`,
  a: r`**The problem**: requests are usually guesses. Over-requested CPU and memory leave nodes "full" by requests while actual usage is 20-30% — the autoscaler keeps adding nodes. Under-requested memory causes OOMKills and evictions.

**Measure**
- Usage percentiles per container over 2-4 weeks (CPU p95/p99, memory max/working set) from Prometheus/cAdvisor.
- **VPA in recommendation mode** ({{updateMode: Off}}) gives target/lower/upper bounds per container without changing pods.
- Request-vs-usage efficiency per namespace: {{sum(usage)/sum(requests)}}.

**Set requests and limits**
- **Memory**: request = limit ≈ observed max working set + headroom (for .NET, include GC behaviour; the heap hard limit follows the limit).
- **CPU**: request ≈ p90-p95 usage (scheduling guarantee and HPA baseline); limits per q7 trade-off.
- Re-evaluate after major releases; automate PRs with recommendations (Goldilocks, Kubecost, custom bots).

**Overcommit**: sum of limits > node capacity is normal for CPU (compressible); be conservative with memory (incompressible). Know your target node utilisation (for example 60-70% of allocatable by requests in production; higher for batch).

**Cost allocation**
- **OpenCost/Kubecost** allocate node, storage and network costs to namespaces/labels using requests vs usage (choose a model: cost by max(request, usage) is common), including idle cost.
- Labels for team, service and cost centre enforced by admission policy; namespace = team ownership.
- Showback first (dashboards per team), then chargeback if the organisation needs it.

**Getting teams to act**
- Make it visible and comparable: monthly efficiency report per team (cost, efficiency %, top over-provisioned workloads).
- Make it easy: automated right-sizing PRs, sensible defaults in the standard chart, LimitRanges.
- Make it safe: canary right-sizing, rollback, SLO guardrails — teams resist when cutting resources has caused incidents before.
- Tie to goals: unit cost per transaction in engineering objectives; celebrate savings.`,
  code: r`~~~yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata: { name: payments-api-recommender, namespace: payments }
spec:
  targetRef: { apiVersion: apps/v1, kind: Deployment, name: payments-api }
  updatePolicy: { updateMode: "Off" }        # recommendations only; HPA keeps scaling replicas
  resourcePolicy:
    containerPolicies:
      - containerName: api
        controlledResources: ["cpu", "memory"]
~~~
~~~text
# PromQL: CPU request efficiency by namespace over 7 days (usage / requests)
sum by (namespace) (rate(container_cpu_usage_seconds_total{container!=""}[7d]))
  / sum by (namespace) (kube_pod_container_resource_requests{resource="cpu"})
~~~`,
  dia: r`flowchart LR
  PROM[Usage percentiles - 4 weeks] --> REC[VPA recommendations Off mode]
  REC --> BOT[Right-sizing PRs to service repos]
  BOT --> GIT[GitOps rollout with SLO guardrail]
  OC[OpenCost: cost by namespace and labels] --> RPT[Monthly team efficiency report]
  RPT --> TEAMS[Teams act: accept PRs, fix outliers]`,
  pts: [r`Requests drive node count; measure usage percentiles before changing them.`, r`VPA in recommendation mode alongside HPA.`, r`Memory request = limit with headroom; CPU request near p90-p95.`, r`Allocate cost with OpenCost/Kubecost and enforced labels; showback before chargeback.`, r`Visibility, automation and safety get teams to act.`],
  ex: r`Automated right-sizing PRs across 300 workloads raised CPU request efficiency from 22% to 55% and cut the node count by a third, with no SLO breaches thanks to canary rollouts.`,
  fu: [r`Which cost allocation model is fairest for bursty workloads?`, r`How do you right-size JVM or .NET apps whose memory grows to fill limits?`],
  pit: [r`Right-sizing from averages.`, r`VPA auto mode fighting HPA.`, r`Cost reports with no owner labels.`] },

{ id: 'q37', level: 'Principal', tags: ['multi-cluster', 'fleet', 'blast-radius', 'multi-region'],
  q: r`One big cluster or many? Design a multi-cluster strategy for a regulated firm: reasons to split, cluster topology across regions, fleet management, cross-cluster traffic and service discovery, and the costs.`,
  a: r`**Reasons to have multiple clusters**
- **Blast radius**: a bad admission webhook, CNI bug, control-plane overload or botched upgrade affects one cluster, not the company.
- **Regulatory scope**: a CDE cluster for PCI, separate clusters per data-residency region.
- **Environment separation**: prod vs non-prod at minimum (different access, change control).
- **Regional resilience**: clusters per region for DR or active-active.
- **Scale limits and upgrade cadence**: very large clusters stress etcd and the API server; teams with different upgrade needs.

**Reasons not to over-split**: each cluster carries control-plane cost, add-ons to maintain (CNI, ingress, policy, observability, secrets, GitOps), upgrade work and capacity fragmentation (idle headroom per cluster). Dozens of tiny clusters without automation become unmanageable.

**A pragmatic topology**: per region: {{prod-shared}} (most services, multi-tenant with guardrails), {{prod-cde}} (PCI), {{nonprod}}; plus ephemeral clusters for CI or platform testing. Two regions for production with warm-standby or active-active per service tier.

**Fleet management**
- Clusters defined as code (Terraform/Cluster API/Crossplane), bootstrapped by GitOps with a standard add-on set pinned by version.
- Argo CD ApplicationSets (cluster generators) or Flux to deploy workloads to clusters by labels (region, tier, compliance).
- Central policy (Kyverno/Gatekeeper bundles), central observability (metrics federation/remote write, logs, traces), centralised identity (OIDC to IdP).
- Upgrade waves: canary cluster → non-prod → prod region A → prod region B.

**Cross-cluster traffic and discovery**
- North-south: global load balancer/DNS (Route 53, Front Door, Cloudflare) to regional gateways.
- East-west: prefer **async integration** (Kafka/queues) between regions; for synchronous calls use multi-cluster service discovery (Kubernetes MCS API implementations, Cilium Cluster Mesh, Istio multi-cluster, cloud service networking such as VPC Lattice).
- Keep data ownership clear: each service's write region; avoid chatty cross-region synchronous calls.

**Costs to quantify**: control plane fees, duplicated add-ons, idle headroom, cross-region data transfer, platform team headcount. The platform team must operate clusters as cattle, not pets.`,
  code: r`~~~yaml
# Argo CD ApplicationSet: deploy payments-api to every prod cluster labelled tier=shared, per region
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata: { name: payments-api-fleet, namespace: argocd }
spec:
  generators:
    - clusters:
        selector: { matchLabels: { env: prod, tier: shared } }
  template:
    metadata: { name: "payments-api-{{name}}" }
    spec:
      project: payments
      source:
        repoURL: https://git.example/platform/config.git
        targetRevision: main
        path: "apps/payments-api/overlays/prod-{{metadata.labels.region}}"
      destination: { server: "{{server}}", namespace: payments }
      syncPolicy: { automated: { prune: true, selfHeal: true } }
~~~`,
  dia: r`flowchart TB
  DNS[Global DNS / Front Door] --> GWA[Gateway - prod-shared eu-west]
  DNS --> GWB[Gateway - prod-shared eu-central]
  subgraph RA[Region A]
    GWA --> CA[prod-shared cluster]
    CDEA[prod-cde cluster]
  end
  subgraph RB[Region B]
    GWB --> CB[prod-shared cluster]
    CDEB[prod-cde cluster]
  end
  CA <-->|Kafka replication / async| CB
  MGMT[Fleet management: IaC + Argo CD ApplicationSets + policy bundles] -.-> CA
  MGMT -.-> CB
  MGMT -.-> CDEA`,
  pts: [r`Split for blast radius, regulatory scope, environments, regions and scale.`, r`Do not over-split: each cluster carries control-plane, add-on and upgrade costs.`, r`Clusters as code, GitOps bootstrap, standard add-ons, upgrade waves.`, r`Global DNS north-south; prefer async east-west between regions.`, r`Quantify costs and staff the platform team to run clusters as cattle.`],
  ex: r`A bank consolidated 46 team-owned clusters into 8 fleet-managed clusters (prod-shared, prod-cde, nonprod per region), cutting upgrade effort by roughly 80% and closing PCI scope ambiguity.`,
  fu: [r`When would you choose active-active across two regional clusters?`, r`How do you handle a service that must call another region synchronously?`],
  pit: [r`One giant cluster for everything including PCI.`, r`Dozens of hand-built clusters.`, r`Chatty synchronous cross-region calls.`] },

{ id: 'q38', level: 'Principal', tags: ['platform-engineering', 'idp', 'golden-paths'],
  q: r`Design an internal developer platform on Kubernetes for 30 .NET and Angular/React teams: the golden path from "new service" to production, abstractions, self-service, guardrails, and how you measure success.`,
  a: r`**Goal**: teams ship safely without becoming Kubernetes experts. The platform is a **product** with users, a roadmap and SLOs.

**Golden path: new service to production**
1. **Scaffold** from a template in the developer portal (Backstage): ASP.NET Core API or worker, or an Angular/React frontend served via a static host/CDN; repo, CI pipeline, Dockerfile (chiseled base), health checks, OpenTelemetry, standard chart values, ownership metadata ({{catalog-info.yaml}}).
2. **CI**: build, test, scan, SBOM, sign; push by digest.
3. **CD**: GitOps — the portal creates namespace(s) via the namespace bootstrap (RBAC, quota, NetworkPolicy, PSA) and an ApplicationSet entry per environment.
4. **Runtime defaults** from the standard chart: probes, PDB, HPA, topology spread, securityContext, ServiceMonitor, alerts on SLOs, dashboards generated.
5. **Dependencies by claim**: database, queue, cache, secrets requested declaratively (Crossplane compositions or a controller that provisions managed services: RDS/Azure SQL, SQS/Service Bus) — teams do not write cloud IaC from scratch.
6. **Progressive delivery** with automated analysis; **promotion** by PR.

**Abstraction level**: expose a small, opinionated interface (service name, image, ports, scaling bounds, dependencies, exposure) and let advanced teams drop down to raw manifests when justified (escape hatches with review). Too much abstraction becomes a bottleneck; none leaves every team reinventing.

**Guardrails**: admission policies (signed images, digests, labels, no privileged), quotas, network defaults, cost labels, policy-as-code reports — automated, with clear error messages and docs links.

**Platform team topology**: platform as a product team, enabling engineers who pair with stream-aligned teams, documented APIs and versioning, deprecation policies.

**Measuring success**
- Time to first production deploy for a new service (target: hours, not weeks).
- DORA metrics per team; change failure rate after adoption.
- Golden-path adoption rate; number of escape hatches.
- Developer satisfaction surveys; support ticket volume.
- Platform SLOs (CI duration, deployment success, cluster availability).`,
  code: r`~~~yaml
# What a team writes (platform API) - a controller or chart expands it into Deployment, HPA, PDB, netpol, alerts, DB claim
apiVersion: platform.bank.example/v1
kind: Service
metadata: { name: statements-api, namespace: statements }
spec:
  owner: team-statements
  image: registry.example/statements-api@sha256:4e1f...
  runtime: dotnet
  expose: { gateway: internal, path: /v1/statements }
  scaling: { minReplicas: 3, maxReplicas: 20, targetActiveRequests: 30 }
  dependencies:
    database: { engine: postgres, size: small, backupRetentionDays: 35 }
    queue: { name: statement-requests, kind: servicebus }
  slo: { availability: "99.9", latencyP99Ms: 300 }
~~~`,
  dia: r`flowchart LR
  DEV[Developer] --> PORTAL[Backstage: scaffold from template]
  PORTAL --> REPO[Repo + CI + catalog entry]
  REPO --> CI[CI: test, scan, sign]
  CI --> GITOPS[Config repo: platform Service CR]
  GITOPS --> ARGO[Argo CD]
  ARGO --> CTRL[Platform controller / Crossplane]
  CTRL --> K8S[Deployment, HPA, PDB, netpol, alerts]
  CTRL --> CLOUD[Managed DB, queue, secrets]`,
  pts: [r`Platform as a product with users, roadmap and SLOs.`, r`Golden path: scaffold, CI, GitOps, defaults, dependency claims, progressive delivery.`, r`Small opinionated interface with reviewed escape hatches.`, r`Automated guardrails with helpful errors.`, r`Measure time to first deploy, DORA, adoption and satisfaction.`],
  ex: r`After launching a Backstage golden path with Crossplane database claims, a bank's time from idea to first production deploy fell from 6 weeks to 2 days, and 26 of 30 teams adopted it within a year.`,
  fu: [r`How do you stop the platform abstraction from becoming a bottleneck?`, r`Build on Backstage or buy a commercial portal?`],
  pit: [r`Building a platform nobody asked for.`, r`Abstractions with no escape hatch.`, r`Measuring platform success by features shipped rather than developer outcomes.`] },

{ id: 'q39', level: 'Principal', tags: ['pci-dss', 'compliance', 'segmentation', 'audit'],
  q: r`Run payment workloads on Kubernetes under PCI DSS: scoping, segmentation options, node and namespace isolation, logging and audit, change control, and what assessors will ask for.`,
  a: r`**Scope first**: anything that stores, processes or transmits cardholder data — and anything that can affect its security — is in scope. In a shared cluster, the **control plane, nodes, CNI, and every pod that can reach CDE pods** may be pulled into scope. Reduce scope before securing it: tokenise early (PSP hosted fields), keep PAN handling in as few services as possible.

**Segmentation options (strongest to weakest)**
1. **Dedicated CDE cluster** (often in a dedicated account/subscription): cleanest scoping, simplest assessor story, separate access and change control. Usually recommended.
2. **Shared cluster with dedicated node pools** (taints/affinity), strict NetworkPolicies, separate namespaces, mTLS and policy — possible, but you must demonstrate that non-CDE workloads cannot affect CDE workloads (shared control plane, shared kernel risks on nodes if pools leak, admin access).
3. Namespace-only separation on shared nodes — hard to defend for CDE.

**Controls on Kubernetes**
- Network: default-deny NetworkPolicies, egress allow-lists (FQDN policies via CNI), mesh mTLS with authorisation, private API server endpoint, no public LoadBalancers in CDE namespaces (admission policy).
- Identity and access: SSO to the API server, RBAC least privilege, **no exec** into CDE pods for humans except break-glass with recording, MFA, quarterly access reviews.
- Workloads: restricted Pod Security, signed images by digest, vulnerability management SLAs, file integrity monitoring/runtime detection (Falco), read-only root filesystems.
- Data: encryption in transit (TLS/mTLS) and at rest (KMS-encrypted etcd secrets, encrypted volumes), keys in HSM-backed KMS, no PAN in logs (log scrubbing in the OTel Collector/Fluent Bit plus tests).
- Logging: **API server audit logs** (who did what), node and workload logs, retained at least 12 months with 3 months immediately available, immutable storage, daily review via SIEM alerts.
- Change control: GitOps — every change a reviewed commit, segregation of duties, sync windows.

**What assessors ask for**: network diagrams and data-flow diagrams including pod-level flows; evidence segmentation is effective (penetration tests from non-CDE namespaces/clusters); RBAC listings and access reviews; audit log samples; vulnerability scan reports; change records; configuration standards (CIS Kubernetes Benchmark results via kube-bench).`,
  code: r`~~~yaml
# API server audit policy (self-managed) - record who exec'd or read secrets in the CDE namespace
apiVersion: audit.k8s.io/v1
kind: Policy
rules:
  - level: RequestResponse
    namespaces: ["cde-tokenisation"]
    resources: [ { group: "", resources: ["pods/exec", "pods/attach", "secrets"] } ]
  - level: Metadata
    namespaces: ["cde-tokenisation"]
  - level: None
    users: ["system:kube-proxy"]
~~~
~~~yaml
# Kyverno: no exec into CDE pods except the break-glass group
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata: { name: deny-exec-cde }
spec:
  validationFailureAction: Enforce
  rules:
    - name: block-exec
      match: { any: [ { resources: { kinds: [Pod/exec], namespaces: [cde-tokenisation] } } ] }
      exclude: { any: [ { subjects: [ { kind: Group, name: grp-cde-breakglass } ] } ] }
      validate: { message: "exec into CDE pods requires break-glass", deny: {} }
~~~`,
  dia: r`flowchart TB
  PSP[PSP hosted fields] --> TOK
  subgraph CDEACC[CDE account - dedicated cluster]
    TOK[Tokenisation service - restricted PSA, mTLS]
    TOK --> HSM[KMS / HSM]
  end
  subgraph SHARED[Shared prod cluster - out of scope]
    API[Payments API - tokens only]
  end
  API -->|PrivateLink + mTLS, tokens| TOK
  AUD[API audit logs, Falco, flow logs] --> SIEM[SIEM - 12 months immutable]`,
  pts: [r`Reduce scope first; shared clusters can pull control plane and neighbours into scope.`, r`A dedicated CDE cluster is the cleanest segmentation.`, r`Default-deny networking, mTLS, restricted pods, signed images, no human exec.`, r`API audit logs and workload logs retained 12 months, scrubbed of PAN.`, r`GitOps change control and evidence: diagrams, pen tests, RBAC reviews, scans, CIS results.`],
  ex: r`A payments company moved tokenisation from a shared cluster to a dedicated CDE cluster; the assessor's scope shrank from 140 services to 6 and the annual assessment took a third of the time.`,
  fu: [r`How do you prove segmentation between namespaces to an assessor?`, r`How do you keep PANs out of logs in practice?`],
  pit: [r`Running CDE workloads on shared nodes with only namespace separation.`, r`Human exec access to CDE pods.`, r`No API server audit logging.`] },

{ id: 'q40', level: 'Principal', tags: ['adr', 'build-vs-buy', 'paas', 'when-not-kubernetes'],
  q: r`When should an organisation NOT use Kubernetes? Compare self-managed Kubernetes, managed Kubernetes (EKS/AKS/GKE), and container PaaS (ECS Fargate, Azure Container Apps, Cloud Run) as an ADR for a mid-size .NET company.`,
  a: r`**Context matters more than technology**: team size, skills, number of services, portability needs, regulatory constraints, and what the business values (speed, cost, control).

| Option | Strengths | Costs |
|---|---|---|
| **Self-managed Kubernetes** (kubeadm, on-prem, VMs) | full control, on-prem/sovereign | you run etcd, control plane, upgrades, certificates — needs a dedicated team; rarely justified in public cloud |
| **Managed Kubernetes** (EKS/AKS/GKE) | managed control plane, Kubernetes ecosystem (operators, GitOps, mesh), portability of skills and manifests | you still own nodes (unless Auto Mode/Autopilot), add-ons, upgrades every few months, networking, security hardening, platform team |
| **Container PaaS** (ECS Fargate, Container Apps, Cloud Run) | minimal operations, scale to zero (some), integrated security, fast onboarding | less extensibility (no CRDs/operators), provider lock-in, platform limits |

**When NOT to use Kubernetes**
- A handful of services and a small team without platform engineers — the operational tax (upgrades, add-ons, security) outweighs benefits.
- Workloads that fit a PaaS well (HTTP APIs, queue workers, scheduled jobs) and no need for Kubernetes-specific capabilities.
- No appetite to fund a platform team (typically several engineers for a production-grade multi-tenant platform).
- When the main motivation is the CV or "portability" with no concrete exit requirement.

**When Kubernetes is the right answer**
- Many services and teams benefiting from a common platform, GitOps and policy at scale.
- Need for operators/CRDs, service mesh, custom scheduling, GPU/ML workloads, hybrid/on-prem consistency.
- Concrete portability or sovereignty requirements.
- An existing strong platform team.

**ADR for a mid-size .NET company (60 engineers, 40 services, one cloud)**: decision — **container PaaS as the default** (ECS Fargate or Container Apps), with managed Kubernetes reconsidered if (a) services exceed ~150, (b) operator-based workloads become central, (c) a regulator requires multi-cloud portability, or (d) a platform team of 5+ is funded. Consequences: lower toil and faster delivery now; some lock-in mitigated by containers, OpenTelemetry and IaC; a migration path exists because workloads are already containerised.`,
  code: r`~~~markdown
# ADR-031: Container platform for 40 .NET services
Status: Accepted (2026-10-11)
## Context
60 engineers, 40 services (APIs, workers, jobs), single cloud, 2 platform engineers, SOX + PCI (tokenisation outsourced).
## Options
1. Managed Kubernetes (EKS/AKS) with GitOps and mesh
2. Container PaaS (ECS Fargate / Azure Container Apps)
3. Self-managed Kubernetes - rejected (no on-prem need, high toil)
## Decision
Option 2 as default. Containers, OTel, IaC keep a migration path to option 1.
## Revisit when
> 150 services, operators become central, portability mandated, or platform team >= 5.
~~~`,
  dia: r`flowchart TD
  START[Container platform decision] --> Q1{Need CRDs, operators, mesh, hybrid?}
  Q1 -->|yes| Q2{Platform team of 5+ funded?}
  Q2 -->|yes| MK[Managed Kubernetes]
  Q2 -->|no| FUND[Fund team or reduce scope]
  Q1 -->|no| PAAS[Container PaaS: ECS Fargate / Container Apps / Cloud Run]
  Q1 -->|on-prem sovereign only| SELF[Self-managed or distribution with vendor support]`,
  pts: [r`Decide on team size, skills, service count, portability and regulation.`, r`Self-managed Kubernetes rarely makes sense in public cloud.`, r`Managed Kubernetes still needs a platform team for nodes, add-ons and upgrades.`, r`Container PaaS fits most mid-size .NET estates with low toil.`, r`Write revisit triggers; containerisation keeps the migration path open.`],
  ex: r`A fintech with 25 services and no platform team moved from a self-built EKS setup to ECS Fargate; upgrade toil disappeared and deployment frequency doubled.`,
  fu: [r`What would make you move from Container Apps to AKS later?`, r`How do you quantify the cost of a platform team versus PaaS premiums?`],
  pit: [r`Adopting Kubernetes for a handful of services.`, r`Underestimating the ongoing upgrade and add-on burden.`, r`Portability as a vague justification.`] },

{ id: 'q41', level: 'Principal', tags: ['disaster-recovery', 'velero', 'gitops', 'rto'],
  q: r`Design disaster recovery for Kubernetes platforms: what state actually needs backing up, GitOps rebuilds versus etcd snapshots versus Velero, persistent data, and how to meet a 1-hour RTO for a lost cluster or region.`,
  a: r`**Classify state**
1. **Cluster configuration and workloads** (Deployments, Services, CRDs, policies): should be **fully in Git**; rebuildable by IaC + GitOps.
2. **Runtime-generated objects** (Secrets synced from stores, certificates issued by cert-manager, operator-created resources): regenerable if their sources exist.
3. **Persistent data** (PVCs of stateful workloads, databases, queues): the hard part — needs application-consistent backups or replication outside the cluster.
4. **Things not in Git** (manual changes, Helm releases installed by hand): the DR gap to eliminate.

**Approaches**
- **IaC + GitOps rebuild (primary)**: Terraform/Cluster API creates the cluster; Argo CD/Flux bootstraps add-ons and apps from Git. Deterministic, tested regularly if you rebuild non-prod clusters routinely ("clusters as cattle").
- **Velero**: backs up Kubernetes objects (to object storage) and volumes (CSI snapshots or file-level backup), restores into a new cluster — useful for stateful namespaces, migrations, and catching non-Git objects. Test restores.
- **etcd snapshots** (self-managed only): restore the exact cluster state; not useful for regional loss unless shipped elsewhere; risky to restore into a different environment.
- **Data**: prefer managed databases with cross-region replicas/backups; for in-cluster databases use operator-native backups to object storage replicated cross-region (CloudNativePG/Barman, Strimzi MirrorMaker 2 for Kafka).

**Meeting a 1-hour RTO for losing a cluster or region**
- **Warm standby cluster** in the second region already running add-ons and scaled-down workloads (or active-active), so recovery is traffic shift + scale-up, not a rebuild from zero (cluster creation plus add-on bootstrap can take 30-60 minutes alone).
- Data replicated continuously (database replicas, object storage replication, Kafka mirroring) with known RPO.
- DNS/global load balancer failover with health checks; runbook and automation.
- Container images replicated to the second region's registry.
- **Drills**: quarterly region failover tests measuring real RTO/RPO; monthly non-prod cluster rebuild from Git to prove the GitOps path.`,
  code: r`~~~bash
# Velero: daily backup of stateful namespaces with CSI snapshots, stored in a cross-region replicated bucket
velero schedule create stateful-daily --schedule "0 1 * * *" \
  --include-namespaces data,risk --snapshot-move-data --ttl 720h
# Restore into the standby cluster during an incident or drill
velero restore create --from-backup stateful-daily-20261011010000 --namespace-mappings risk:risk
# GitOps rebuild path: new cluster + bootstrap app-of-apps
terraform -chdir=clusters/prod-euc apply -auto-approve && \
  kubectl apply -f bootstrap/argocd-app-of-apps.yaml --context prod-euc
~~~`,
  dia: r`flowchart LR
  GIT[(Git: cluster + apps config)] -->|GitOps| C1[Primary cluster - region A]
  GIT -->|GitOps| C2[Warm standby cluster - region B]
  C1 --> DB1[(Managed DB primary)] -->|replication| DB2[(DB replica region B)]
  C1 -->|Velero backups| OBJ[(Object storage - cross-region replicated)]
  OBJ --> C2
  REG1[Registry A] -->|replication| REG2[Registry B]
  GLB[Global DNS / LB health checks] --> C1
  GLB -.failover.-> C2`,
  pts: [r`Classify state: config in Git, regenerable objects, persistent data, and gaps.`, r`IaC + GitOps rebuild is primary; Velero for stateful namespaces and gaps; etcd snapshots only self-managed.`, r`Data replication outside the cluster defines RPO.`, r`A 1-hour RTO needs a warm standby cluster, not a rebuild from zero.`, r`Drill region failovers and routine cluster rebuilds.`],
  ex: r`A platform team rebuilt its staging cluster from Git every Monday; when a production cluster was corrupted by a bad CNI upgrade, they rebuilt it in 50 minutes because the path was routine.`,
  fu: [r`What would you find missing the first time you rebuild a cluster from Git?`, r`How do you handle in-flight Kafka messages during region failover?`],
  pit: [r`Treating etcd snapshots as the DR strategy.`, r`Manual changes that never reach Git.`, r`Untested Velero restores.`] },

{ id: 'q42', level: 'Principal', tags: ['finops', 'cost', 'kubernetes-economics'],
  q: r`Kubernetes spend doubled in a year. As Principal Engineer, how do you analyse and reduce it across compute, storage, networking and the platform itself, without hurting reliability?`,
  a: r`**1. Attribute the cost**: OpenCost/Kubecost or cloud split-cost allocation by namespace/label; separate **workload cost**, **idle cost** (allocated but unused node capacity), **platform overhead** (system pods, add-ons, control planes), storage and network. Unit metrics: cost per transaction or per active customer.

**2. Compute (usually 60-80%)**
- **Right-size requests** (q36): idle cost comes from over-requesting; target 60-70% request utilisation in prod.
- **Node shape and purchase**: Karpenter/autoprovisioning with broad instance families, **Graviton/ARM** for .NET (often 20-40% better price-performance), **Spot** for stateless workers/CI/batch, Savings Plans/reservations for the stable baseline.
- **Consolidation** enabled with PDBs and business-hours disruption budgets.
- **Scale non-prod down** nights and weekends (KEDA cron, cluster schedules); ephemeral preview environments with TTLs.
- Reduce sidecar overhead (ambient mesh or no mesh), DaemonSet bloat (each DaemonSet runs on every node).

**3. Storage**: unused PVCs (Retain policy leftovers), oversized volumes, snapshots without retention, premium disks where standard suffices, log/metrics retention in self-hosted observability.

**4. Networking (often a surprise)**: cross-AZ traffic between services (topology-aware routing, trafficDistribution PreferClose), NAT gateway processing (VPC endpoints, image pulls through endpoints/pull-through cache), load balancers per service (consolidate behind a Gateway), cross-region replication volume.

**5. Platform**: too many small clusters (control-plane fees, duplicated add-ons, fragmented headroom), observability ingestion (metrics cardinality, log verbosity — often a top-3 cost), unused namespaces and abandoned workloads.

**6. Guardrails so savings stick**: quotas and LimitRanges, cost visible in PRs, monthly team showback, budget alerts, policies (no LoadBalancer Services, required cost labels).

**Reliability guardrails**: keep N-1 zone capacity for critical services, no Spot for singletons/stateful sets, SLO monitoring during right-sizing rollouts, canary changes.`,
  code: r`~~~text
# PromQL: idle CPU cost signal - allocatable minus requested cores per node pool
sum by (label_karpenter_sh_nodepool) (kube_node_status_allocatable{resource="cpu"} * on(node) group_left(label_karpenter_sh_nodepool) kube_node_labels)
- sum by (label_karpenter_sh_nodepool) (kube_pod_container_resource_requests{resource="cpu"} * on(node) group_left(label_karpenter_sh_nodepool) kube_node_labels)

# Cross-zone traffic is billed: keep Service traffic in-zone where possible
# spec.trafficDistribution: PreferClose  on high-volume internal Services
~~~`,
  dia: r`flowchart LR
  ALLOC[OpenCost allocation: workload, idle, platform, storage, network] --> A1[Right-size requests]
  ALLOC --> A2[Karpenter + Graviton + Spot + Savings Plans]
  ALLOC --> A3[Non-prod schedules, preview TTLs]
  ALLOC --> A4[In-zone routing, endpoints, fewer LBs]
  ALLOC --> A5[Observability cardinality and retention]
  A1 --> SLO[Guardrails: N-1 capacity, SLO checks, canary]`,
  pts: [r`Attribute cost into workload, idle, platform, storage and network with unit metrics.`, r`Right-size requests, ARM nodes, Spot and commitments for compute.`, r`Network costs: cross-AZ traffic, NAT, per-service load balancers.`, r`Platform costs: cluster sprawl and observability ingestion.`, r`Make savings stick with guardrails, without breaking reliability.`],
  ex: r`A bank cut Kubernetes spend 41%: right-sizing (15%), Graviton and Spot (12%), non-prod schedules (7%), in-zone routing and VPC endpoints (4%), metrics cardinality fixes (3%).`,
  fu: [r`How do you charge platform overhead fairly to teams?`, r`What would you never put on Spot?`],
  pit: [r`Cutting requests without SLO monitoring.`, r`Ignoring cross-AZ and NAT costs.`, r`Cluster sprawl with idle headroom in each.`] },

{ id: 'q43', level: 'Principal', tags: ['security-architecture', 'threat-model', '4cs'],
  q: r`Present an end-to-end Kubernetes threat model and security architecture using the 4Cs (cloud, cluster, container, code). Which attack paths matter most, and which controls would you prioritise in the first 90 days?`,
  a: r`**The 4Cs** (each layer depends on the one outside it)
| Layer | Key threats | Key controls |
|---|---|---|
| **Cloud** | leaked cloud credentials, over-privileged node roles, public API endpoint, IMDS abuse | private API endpoint or restricted CIDRs, least-privilege node roles, workload identity, IMDSv2 hop limit 1, account guardrails (SCPs/Azure Policy), KMS for etcd secrets |
| **Cluster** | over-broad RBAC, anonymous auth, exposed dashboards, malicious admission/webhooks, unpatched versions | SSO + RBAC least privilege, no system:masters for humans, audit logging, admission policies, current versions, CIS benchmark |
| **Container** | vulnerable or malicious images, privileged pods, container escape | signed images by digest, minimal images, restricted Pod Security, seccomp, read-only FS, runtime detection |
| **Code** | app vulnerabilities (SSRF, injection, deserialisation), secrets in code, dependency attacks | secure SDLC, SAST/DAST, dependency scanning, secrets from stores, SSRF protections |

**Most important attack paths**
1. **App compromise → service account token → API server**: an RCE in a pod with an over-privileged ServiceAccount escalates to the cluster. Controls: no token automount, least-privilege SAs, NetworkPolicy blocking API server access from app pods where possible.
2. **App compromise → IMDS → node/cloud credentials**: SSRF to {{169.254.169.254}}. Controls: IMDSv2 with hop limit 1, block IMDS via NetworkPolicy, workload identity instead of node roles.
3. **Privileged pod or hostPath → node root → all secrets on the node**. Controls: restricted PSA, admission policy, dedicated node pools for sensitive workloads.
4. **CI/CD compromise → deploy malicious image**. Controls: signed images verified at admission, OIDC-federated CI with scoped roles, protected branches.
5. **Lateral movement across flat pod networks**. Controls: default-deny NetworkPolicies, mTLS with authorisation.
6. **Stolen kubeconfig / admin credentials**. Controls: short-lived OIDC tokens, MFA, private endpoint, just-in-time admin.

**First 90 days (prioritised by risk reduction per effort)**
- Days 0-30: private API endpoint, SSO/RBAC review removing cluster-admin sprawl, audit logging to SIEM, KMS encryption at rest, IMDS protections, automount off by default, Pod Security baseline enforced everywhere / restricted on app namespaces in warn mode.
- Days 30-60: default-deny NetworkPolicies per namespace, image registry restrictions and digest pinning, vulnerability scanning with SLAs, External Secrets + workload identity, upgrade to supported versions.
- Days 60-90: image signing and admission verification, runtime detection, restricted PSA enforced, mTLS where justified, red-team exercise to validate.`,
  code: r`~~~yaml
# Block pod access to the cloud metadata service (keep cluster DNS and other egress via separate policies)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: deny-imds, namespace: payments }
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except: ["169.254.169.254/32"]
~~~
~~~bash
# Quick RBAC risk scan: who can create pods, read secrets or exec cluster-wide?
kubectl auth can-i --list --as=system:serviceaccount:payments:payments-api
kubectl get clusterrolebindings -o json | jq -r '.items[] | select(.roleRef.name=="cluster-admin") | .subjects[]? | "\(.kind) \(.name)"'
~~~`,
  dia: r`flowchart LR
  ATK[Attacker] -->|SSRF / RCE| APP[App pod]
  APP -->|SA token| API[API server]
  APP -->|169.254.169.254| IMDS[Instance metadata]
  APP -->|flat network| OTHER[Other pods]
  CI[Compromised CI] -->|unsigned image| CLUSTER[Cluster]
  API -.-> X1[Blocked: least-privilege SA, no token automount]
  IMDS -.-> X2[Blocked: IMDSv2 hop limit 1 + egress netpol]
  OTHER -.-> X3[Blocked: default-deny netpol + mTLS]
  CLUSTER -.-> X4[Blocked: signature verification at admission]`,
  pts: [r`4Cs: cloud, cluster, container, code; inner layers rely on outer ones.`, r`Key paths: SA token abuse, IMDS credential theft, privileged pods, CI compromise, lateral movement, stolen admin credentials.`, r`Controls: least-privilege SAs, IMDS protection, restricted PSA, signed images, default-deny networking, JIT admin.`, r`Prioritise by risk reduction per effort over 90 days.`, r`Validate with red-team exercises.`],
  ex: r`A red-team exercise reached cluster-admin in 40 minutes via an SSRF and a default ServiceAccount bound to an over-broad role; after the 90-day plan, the same team stalled at the first pod.`,
  fu: [r`How do you validate that NetworkPolicies actually block lateral movement?`, r`Which control gives the biggest risk reduction for the least effort?`],
  pit: [r`Public API endpoints with broad CIDRs.`, r`Default ServiceAccounts with powerful roles.`, r`Ignoring IMDS from pods.`] },

{ id: 'q44', level: 'Principal', tags: ['migration', 'vms-to-kubernetes', 'twelve-factor', 'dotnet'],
  q: r`Lead the migration of 60 .NET services from VMs (IIS and Windows services) to Kubernetes. What has to change in the applications, how do you sequence the move, and how do you avoid an outage-prone big bang?`,
  a: r`**Readiness assessment per service** (twelve-factor gaps)
- **Runtime**: .NET Framework on IIS needs porting to modern .NET (Linux containers) — or Windows containers/node pools as a stopgap (heavier images, fewer features, slower scaling). Plan porting effort (System.Web, WCF, COM, Windows auth).
- **Configuration**: web.config transforms and machine-level settings → environment variables, mounted config, secrets from stores.
- **State**: in-memory sessions, local file writes, sticky sessions → distributed cache, object storage, stateless instances.
- **Identity**: Windows integrated auth/Kerberos → OIDC/JWT; service accounts → workload identity.
- **Scheduling**: Windows scheduled tasks → CronJobs; Windows services → worker services (BackgroundService).
- **Networking**: hard-coded hostnames/IPs, firewall allow-lists by server IP (egress through NAT with fixed IPs), certificates.
- **Observability**: event log/file logs → structured stdout, OpenTelemetry, health endpoints.
- **Shutdown**: handle SIGTERM gracefully (q17).

**Sequencing**
1. Build the platform first: landing zone, cluster(s), GitOps, standard chart, observability, secrets, CI templates.
2. **Pilot** with 2-3 low-risk, representative services; document the playbook and fix platform gaps.
3. **Waves** grouped by dependency clusters (services that talk a lot move together to avoid cross-environment latency) and by risk (internal → customer-facing → payment-critical).
4. Strangler at the edge: a gateway routes paths to the new Kubernetes service or the old VM; switch per route.
5. Decommission VMs only after a stable period and rollback window.

**Avoiding big bang**
- Run old and new in parallel; shift traffic gradually (weights at the gateway/DNS), compare error rates and latency.
- Shadow traffic or dual-run for calculation-critical services (fees, interest).
- Keep databases where they are initially (connectivity from the cluster); data migration is a separate project.
- Rollback = route traffic back to VMs, rehearsed.

**People**: train teams on containers and the platform; platform engineers embedded with migrating teams; clear definition of done (SLOs met, runbooks, alerts, cost tags).`,
  code: r`~~~csharp
// Typical changes when moving a Windows service to a container worker
var builder = Host.CreateApplicationBuilder(args);
builder.Configuration.AddEnvironmentVariables();                 // replaces machine-level config / registry
builder.Services.AddHostedService<StatementWorker>();            // was a Windows Service
builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(25)); // SIGTERM drain
builder.Logging.AddJsonConsole();                                // was EventLog / rolling files
builder.Services.AddOpenTelemetry().WithTracing(t => t.AddSource("Statements").AddOtlpExporter());
builder.Services.AddStackExchangeRedisCache(o => o.Configuration = builder.Configuration["Redis"]); // was in-memory session
await builder.Build().RunAsync();
~~~`,
  dia: r`flowchart LR
  U[Users] --> GW[Gateway - per-route weights]
  GW -->|/statements 100%| K8S[Kubernetes: statements-api]
  GW -->|/accounts 20%| K8S2[Kubernetes: accounts-api]
  GW -->|/accounts 80%| VM[IIS VMs: accounts]
  GW -->|everything else| VM2[IIS VMs]
  K8S --> DB[(Existing SQL Server)]
  VM --> DB`,
  pts: [r`Assess twelve-factor gaps: runtime, config, state, identity, scheduling, networking, logging, shutdown.`, r`Platform first, then a pilot, then dependency-grouped waves by risk.`, r`Strangler routing at the gateway with gradual weights.`, r`Parallel runs and rehearsed rollback; leave data migration for later.`, r`Train and embed platform engineers with teams.`],
  ex: r`A lender migrated 60 services in 9 waves over 14 months; weighted routing caught a session-affinity bug at 10% traffic in wave 3 and the team rolled back in two minutes.`,
  fu: [r`When are Windows containers an acceptable end state?`, r`How do you handle services that require Kerberos to on-premises systems?`],
  pit: [r`Lifting IIS apps into containers without addressing state and config.`, r`Migrating chatty dependencies separately.`, r`Decommissioning VMs before a rollback window passes.`] },

{ id: 'q45', level: 'Principal', tags: ['control-plane-scale', 'api-priority-fairness', 'large-clusters'],
  q: r`Your largest cluster is approaching its limits: slow kubectl, API server 429s, controllers lagging. Explain the scalability limits of Kubernetes, API Priority and Fairness, the usual culprits, and your remediation plan.`,
  a: r`**Published scalability envelope** (upstream SLO-tested): up to about **5,000 nodes**, **150,000 pods**, **110 pods per node** by default, 300,000 containers — but real limits depend on object churn, controllers and add-ons. Managed providers publish their own limits and scale control planes automatically, within quotas.

**What actually stresses the control plane**
- **LIST calls without pagination or watch caching** (a monitoring agent listing all pods every 30 s across 100,000 pods).
- **Controllers/operators** that re-list, update status at high frequency, or fight each other (two controllers owning the same field).
- **High object churn**: many short-lived pods (CI jobs), events, leases, frequent ConfigMap updates.
- **Large objects** (huge CRs or ConfigMaps near 1 MiB), many CRDs with big schemas.
- **Webhooks** adding latency to every write.
- etcd disk latency and database size (q33).

**API Priority and Fairness (APF)** (GA): the API server classifies requests into **FlowSchemas** mapped to **PriorityLevelConfigurations** with concurrency shares and queues. System and leader-election traffic gets protected priority; noisy clients are queued or rejected with 429 instead of starving everyone. You can add FlowSchemas to isolate a misbehaving controller or tenant.

**Diagnosis**
- API server metrics: request latency by verb/resource ({{apiserver_request_duration_seconds}}), APF rejections ({{apiserver_flowcontrol_rejected_requests_total}}) and queue waits by flow schema, top user agents.
- Audit logs aggregated by user agent and verb (who LISTs most?).
- etcd metrics: fsync latency, DB size, request rate.

**Remediation plan**
1. Fix the worst clients: informers with watch instead of polling LISTs, pagination, resourceVersion-based lists served from cache, lower status update frequency, upgrade misbehaving operators.
2. Isolate with APF FlowSchemas (cap a noisy controller's concurrency).
3. Reduce churn: TTL for finished Jobs, event rate limits, move CI to a dedicated cluster.
4. Trim webhooks (scope rules, ValidatingAdmissionPolicy instead).
5. Architectural: **split the cluster** by tenant/workload class (q37) — the real long-term fix when one cluster holds everything.`,
  code: r`~~~yaml
# APF: isolate a chatty reporting controller so it cannot starve other clients
apiVersion: flowcontrol.apiserver.k8s.io/v1
kind: PriorityLevelConfiguration
metadata: { name: low-priority-controllers }
spec:
  type: Limited
  limited:
    nominalConcurrencyShares: 10
    limitResponse: { type: Queue, queuing: { queues: 16, handSize: 4, queueLengthLimit: 50 } }
---
apiVersion: flowcontrol.apiserver.k8s.io/v1
kind: FlowSchema
metadata: { name: reporting-controller }
spec:
  priorityLevelConfiguration: { name: low-priority-controllers }
  matchingPrecedence: 1000
  distinguisherMethod: { type: ByUser }
  rules:
    - subjects: [ { kind: ServiceAccount, serviceAccount: { name: reporting-controller, namespace: reporting } } ]
      resourceRules: [ { verbs: ["list", "watch", "get"], apiGroups: ["*"], resources: ["*"], namespaces: ["*"] } ]
~~~`,
  dia: r`flowchart LR
  C1[kubelets, leader election] --> APF{API Priority and Fairness}
  C2[GitOps, users] --> APF
  C3[Chatty reporting controller] --> APF
  APF -->|system priority| API[API server]
  APF -->|workload-high| API
  APF -->|low-priority queue, 429 if full| API
  API --> CACHE[Watch cache]
  API --> ETCD[(etcd)]`,
  pts: [r`Upstream envelope: ~5,000 nodes, 150,000 pods, 110 pods per node; churn matters more.`, r`Culprits: unpaginated LISTs, chatty controllers, churn, large objects, webhooks, etcd latency.`, r`APF classifies and queues requests so noisy clients cannot starve critical ones.`, r`Diagnose by user agent, verb and flow schema metrics plus audit logs.`, r`Fix clients, isolate with APF, cut churn, trim webhooks, split clusters.`],
  ex: r`A monitoring agent listing all pods every 15 seconds caused API server 429s for deployments; switching it to an informer and adding an APF FlowSchema cut API server CPU by 60%.`,
  fu: [r`Why are watches cheaper than repeated LISTs?`, r`When is splitting the cluster the only real fix?`],
  pit: [r`Scaling the control plane without finding the noisy client.`, r`Polling LISTs in custom controllers.`, r`Running CI churn in the production cluster.`] },

{ id: 'q46', level: 'Principal', tags: ['architecture-review', 'anti-patterns'],
  q: r`Review this setup: one cluster for dev, test and prod; everyone has cluster-admin; images tagged latest from Docker Hub; no requests or limits; secrets in Git as plain YAML; a public API endpoint; deployments via kubectl from laptops; no NetworkPolicies; the database runs as a single-replica StatefulSet with hostPath storage. Prioritise and give a remediation plan.`,
  a: r`Structure by risk: **security exposure**, **data loss**, **availability**, **operability**, then **cost**.

**Critical (week 1)**
1. **Secrets in Git (plaintext)** — treat as compromised: rotate every credential, purge from history where feasible, move to External Secrets with a cloud store; enable KMS encryption at rest.
2. **Everyone cluster-admin + public API endpoint** — restrict the endpoint (private or allow-listed CIDRs), SSO/OIDC with groups, least-privilege RBAC, remove static admin kubeconfigs, enable audit logging.
3. **Single-replica database on hostPath** — one node failure loses data; hostPath ties it to a node and bypasses backups. Immediately take a consistent backup and test restore; migrate to a managed database (or an operator with replicated storage and backups) within weeks.

**High (month 1)**
4. **Prod shares a cluster with dev/test** — split at least prod from non-prod (separate clusters, ideally separate accounts); dev experiments must not be able to evict or reach production.
5. **kubectl from laptops** — GitOps with reviewed changes and audit trail; humans read-only in prod.
6. **latest tags from Docker Hub** — private registry, pull-through cache, pinned digests, scanning, rate-limit resilience; admission policy to enforce.
7. **No requests/limits** — BestEffort pods get evicted first and cause noisy neighbours; add LimitRanges, quotas, and right-sized requests.

**Medium (quarter 1)**
8. **No NetworkPolicies** — default deny with explicit allows, starting with prod namespaces.
9. Pod Security restricted, probes, PDBs, topology spread, HPA.
10. Observability and SLO alerts; cost labels.

**Presenting it**: a risk register (finding, impact, likelihood, owner, date), immediate containment actions first, a target architecture, and quick wins that build trust. Acknowledge constraints (the team shipped value fast) and sequence changes so each is safe and reversible.`,
  code: r`~~~text
Finding                              Risk      Action                                           Owner     Due
Plaintext secrets in Git             Critical  Rotate all, purge, External Secrets, KMS          Platform  +2d
Public API + everyone cluster-admin  Critical  Private endpoint, SSO, least-privilege RBAC        Platform  +5d
DB single replica on hostPath        Critical  Backup + restore test now; managed DB migration    Data      +3d / +30d
Prod shares cluster with dev/test    High      Separate prod cluster/account                     Platform  +30d
kubectl from laptops                 High      GitOps (Argo CD), read-only humans in prod        Platform  +30d
latest tags from Docker Hub          High      Private registry, digests, scanning, admission    Platform  +21d
No requests/limits                   High      LimitRanges, quotas, right-sized requests         Teams     +30d
No NetworkPolicies                   Medium    Default deny + allows, prod first                 Teams     +60d
~~~`,
  dia: r`flowchart LR
  subgraph Before
    ONE[Single cluster: dev + test + prod, public API, all cluster-admin]
    ONE --> DB1[(DB: 1 replica, hostPath)]
    LAP[Laptops kubectl] --> ONE
    HUB[Docker Hub latest] --> ONE
  end
  subgraph After
    PROD[Prod cluster - private API, SSO RBAC, GitOps]
    NP[Non-prod cluster]
    PROD --> MDB[(Managed DB, replicated, backed up)]
    REG[Private registry: signed digests] --> PROD
    ESO[External Secrets + KMS] --> PROD
  end`,
  pts: [r`Prioritise security exposure and data-loss risk first.`, r`Rotate leaked secrets, lock down API access and RBAC, back up the database now.`, r`Separate prod from non-prod; GitOps instead of laptops.`, r`Private registry with digests; requests, limits and quotas.`, r`Then network policies, pod security, resilience and observability via a risk register.`],
  ex: r`In a similar review, the hostPath database's node failed two weeks later; because a backup and restore test had been done on day one, the team lost 20 minutes of data instead of everything.`,
  fu: [r`What do you do first if you suspect the leaked secrets were used?`, r`How do you move teams off cluster-admin without stopping delivery?`],
  pit: [r`Starting with cost optimisation while secrets are exposed.`, r`Recommending a rewrite.`, r`Unprioritised findings lists.`] },

{ id: 'q47', level: 'Principal', tags: ['incident', 'postmortem', 'webhook', 'cluster-outage'],
  q: r`Postmortem: a policy webhook with failurePolicy Fail went down after a node upgrade; no pods could be created cluster-wide for 70 minutes, including the webhook's own replacement pods, during a market-open period. Lead the incident response and write the corrective actions.`,
  a: r`**During the incident**
1. **Declare and coordinate**: incident commander, communications lead, technical lead; status page; business stakeholders (trading desks) informed of impact: existing pods serve, but no scaling, deploys or rescheduling.
2. **Stabilise**: the fastest safe mitigation is to remove the webhook from the write path — patch the ValidatingWebhookConfiguration to {{failurePolicy: Ignore}} or delete it (break-glass admin, recorded). This is an accepted temporary security reduction; record the decision and time.
3. **Recover**: webhook pods reschedule now that admission works; verify cluster health (pending pods scheduled, HPA scaling, deployments resuming); restore the webhook configuration once its deployment is healthy (with fixes below).
4. **Communicate** throughout; capture timeline evidence (events, API server logs, admission metrics).

**Root cause (5 whys)**
- Node upgrade drained the nodes hosting all webhook replicas (no PDB, no anti-affinity).
- Replacement pods needed admission → webhook unavailable → **circular dependency**, because the webhook's own namespace was not excluded.
- failurePolicy Fail applied to **all resources in all namespaces**, including kube-system.
- No alert on webhook availability or admission failure rate; upgrade ran at a risky time.

**Corrective actions**
| Action | Type | Owner |
|---|---|---|
| Exclude kube-system, the webhook's namespace and platform namespaces via namespaceSelector | prevent | Platform |
| Webhook HA: ≥3 replicas, PDB maxUnavailable 1, zone spread, priority class | prevent | Platform |
| Scope rules to needed resources/operations; timeout 3 s | prevent | Platform |
| Move simple rules to ValidatingAdmissionPolicy (in-process, no availability dependency) | prevent | Platform |
| Alerts on admission webhook errors/latency and pending pod count | detect | SRE |
| Upgrade change policy: no node upgrades within market hours; pre-flight check of critical webhooks/PDBs | prevent | Change mgmt |
| Break-glass runbook for admission outages, rehearsed quarterly | respond | SRE |
| Chaos test: kill all webhook pods in staging monthly | verify | Platform |

**Blameless framing**: the system allowed a single configuration choice to create a cluster-wide dependency; fixes target the system, not the engineer.`,
  code: r`~~~yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata: { name: policy-webhook }
webhooks:
  - name: validate.policy.bank.example
    failurePolicy: Fail                       # kept for security, made safe by scope + HA
    timeoutSeconds: 3
    sideEffects: None
    admissionReviewVersions: ["v1"]
    clientConfig: { service: { name: policy-webhook, namespace: policy-system, path: /validate } }
    namespaceSelector:
      matchExpressions:
        - { key: kubernetes.io/metadata.name, operator: NotIn, values: [kube-system, policy-system, platform-system] }
    rules:
      - { apiGroups: ["apps"], apiVersions: ["v1"], operations: ["CREATE", "UPDATE"], resources: ["deployments", "statefulsets"] }
~~~
~~~bash
# Break-glass mitigation used during the incident (recorded in the timeline)
kubectl patch validatingwebhookconfiguration policy-webhook --type=json \
  -p='[{"op":"replace","path":"/webhooks/0/failurePolicy","value":"Ignore"}]'
~~~`,
  dia: r`flowchart TD
  UPG[Node upgrade drains webhook nodes] --> DOWN[All webhook replicas gone]
  DOWN --> CREATE[Any pod create calls webhook]
  CREATE -->|failurePolicy Fail, unreachable| REJ[Rejected cluster-wide]
  REJ --> SELF[Webhook replacement pods also rejected - circular]
  SELF --> MIT[Mitigation: failurePolicy Ignore via break-glass]
  MIT --> REC[Webhook pods start, restore config with fixes]`,
  pts: [r`Stabilise first: remove the webhook from the write path via break-glass, record the decision.`, r`Root cause: circular dependency, unscoped Fail policy, no HA, no alerts, risky timing.`, r`Corrective actions span prevent, detect, respond and verify.`, r`Prefer in-process ValidatingAdmissionPolicy for simple rules.`, r`Blameless: fix the system that allowed a single point of failure.`],
  ex: r`After this postmortem a trading firm ran monthly chaos tests killing all admission webhook pods in staging; the second test revealed a different operator's webhook with the same flaw.`,
  fu: [r`Was setting failurePolicy Ignore the right call given the security policy?`, r`How would you detect a similar circular dependency before it bites?`],
  pit: [r`Debugging the webhook for an hour before mitigating.`, r`Corrective actions that only say "be more careful".`, r`Leaving the webhook on Ignore permanently.`] },

{ id: 'q48', level: 'Principal', tags: ['fleet-governance', 'policy-as-code', 'standards'],
  q: r`You are responsible for Kubernetes standards across 15 clusters and 40 teams. How do you govern versions, add-ons, policies, and exceptions consistently — and keep teams fast?`,
  a: r`**Principle**: standards are encoded in **automation and defaults**, not documents; governance should make the compliant path the fastest path.

**What to standardise**
- **Cluster baseline**: Kubernetes version policy (N or N-1, quarterly upgrade waves), node images, CNI, CSI, CoreDNS, gateway, policy engine, secrets operator, observability agents, GitOps controller — all versions pinned in a **platform repo** and rolled out by GitOps to clusters by wave labels.
- **Workload baseline**: standard chart/platform API (probes, PDB, HPA, securityContext, topology spread, labels, ServiceMonitor), namespace bootstrap bundle (RBAC, quota, LimitRange, NetworkPolicy, PSA).
- **Policy bundle**: Kyverno/Gatekeeper/ValidatingAdmissionPolicy sets versioned like software — registry and signature rules, labels, resources, exposure rules, PSA.

**How to roll out policies safely**: audit mode with reports → fix existing violations with teams (automated PRs) → enforce in non-prod → enforce in prod; policy tests in CI (Kyverno CLI, conftest) against real manifests; clear messages with doc links.

**Exceptions**: declarative, time-bound **policy exceptions** (Kyverno PolicyException or labelled exemptions) in Git with an owner, reason, compensating control and expiry; dashboards of active exceptions; recurring exceptions trigger a rule review.

**Fleet visibility**: a scorecard per cluster and per team — version currency, policy violations, critical CVEs, PDB coverage, request efficiency, SLO compliance; published monthly.

**Keeping teams fast**
- Self-service namespaces and dependencies through the platform API.
- Fast feedback: policy violations caught in CI before merge, not at deploy time.
- Platform changes communicated with deprecation windows and migration tooling.
- A platform support channel and office hours; platform SLOs.
- Limit reviews to high-risk changes (internet exposure, new data stores with regulated data, privileged workloads).

**Metrics**: DORA per team (governance must not degrade them), time to apply a fleet-wide security patch (target hours/days), % clusters on supported versions, % workloads compliant, number and age of exceptions.`,
  code: r`~~~yaml
# Time-bound, reviewed exception in Git (Kyverno PolicyException)
apiVersion: kyverno.io/v2
kind: PolicyException
metadata:
  name: legacy-batch-root-until-2026-12-31
  namespace: kyverno-exceptions
  annotations:
    owner: team-reporting
    reason: "Vendor batch image requires root; vendor fix due Q4"
    compensating-controls: "dedicated tainted node pool, no network egress except DB"
    expires: "2026-12-31"
spec:
  exceptions:
    - policyName: require-run-as-nonroot
      ruleNames: [check-runasnonroot]
  match:
    any: [ { resources: { kinds: [Pod], namespaces: [reporting-batch], names: ["vendor-batch-*"] } } ]
~~~`,
  dia: r`flowchart LR
  PREPO[(Platform repo: versions, add-ons, policy bundle)] -->|GitOps waves| C1[Canary cluster]
  C1 --> C2[Non-prod clusters]
  C2 --> C3[Prod clusters]
  CI[Team CI: policy tests before merge] --> TEAMS[Team workloads]
  EXC[Time-bound exceptions in Git] --> C3
  SCORE[Fleet scorecard: versions, CVEs, policy, efficiency] --> REVIEW[Monthly review]`,
  pts: [r`Encode standards in pinned platform repos, charts and policy bundles.`, r`Roll out policies audit → fix → enforce, tested in CI.`, r`Time-bound exceptions in Git with owners and expiries.`, r`Fleet scorecards make compliance visible.`, r`Keep teams fast with self-service, early feedback and limited reviews.`],
  ex: r`A bank applied a critical runc CVE fix across 15 clusters in 36 hours using wave labels in its platform repo; the previous comparable patch had taken three weeks of tickets.`,
  fu: [r`How do you handle a team blocked by a new policy on release day?`, r`How do you version and test the policy bundle itself?`],
  pit: [r`Standards that live only in wiki pages.`, r`Permanent exceptions.`, r`Policy violations discovered only at deploy time.`] },

{ id: 'q49', level: 'Principal', tags: ['networking', 'cni', 'cilium', 'ip-planning', 'egress'],
  q: r`Networking at scale: choose a CNI for a large regulated estate (VPC-native vs overlay vs eBPF/Cilium), plan IP space, control egress with stable IPs and FQDN policies, encrypt pod traffic, and connect clusters.`,
  a: r`**CNI models**
| Model | Examples | Pros | Cons |
|---|---|---|---|
| **VPC-native (routable pod IPs)** | AWS VPC CNI, Azure CNI (pod subnet), GKE VPC-native | pods are first-class in the VPC: SGs, flow logs, no encapsulation | consumes VPC IPs fast; IP planning critical |
| **Overlay** | Azure CNI Overlay, Calico VXLAN, Flannel | saves VPC address space | SNAT to reach VPC resources; pods not directly addressable from outside |
| **eBPF-based** | Cilium (also as AKS/GKE dataplane), Calico eBPF | kube-proxy replacement, L3-L7 policy, FQDN egress rules, Hubble flow visibility, WireGuard/IPsec encryption, Cluster Mesh | new skills, kernel requirements, another critical component |

For a large regulated estate, a common choice is **Cilium** (managed where available) for policy expressiveness, observability and encryption, on either VPC-native or overlay IPAM depending on address space.

**IP planning**
- Allocate non-overlapping ranges per cluster from central IPAM, including pod and service CIDRs, accounting for growth (pods per node × max nodes × surge during upgrades).
- VPC-native: large pod subnets or secondary CIDRs (100.64.0.0/10 space), prefix delegation.
- Overlapping ranges across clusters break Cluster Mesh, peering and on-prem routing — fix early.

**Egress control**
- Default deny egress; allow by **FQDN** (Cilium/Calico FQDN policies) for PSPs, card schemes, SaaS APIs.
- **Stable source IPs** for partner allow-lists: NAT gateways per AZ, or Cilium **egress gateway** / dedicated egress nodes so only specific pods use specific IPs.
- Central egress inspection (cloud firewall) for compliance logging.

**Encryption in transit**: mTLS (mesh) for identity-aware encryption, or CNI-level **WireGuard/IPsec** node-to-node encryption for blanket coverage with less overhead; many regulated estates use both for sensitive paths.

**Connecting clusters**: Cilium Cluster Mesh, mesh multi-cluster, or cloud service networking (VPC Lattice, PrivateLink); prefer explicit, few cross-cluster dependencies and async integration.

**Observability**: flow logs (Hubble) as evidence for segmentation audits and for debugging drops ("why can't payments reach ledger?").`,
  code: r`~~~yaml
# Cilium: allow the PSP adapter to reach only named external hosts, with DNS visibility
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata: { name: psp-adapter-egress, namespace: payments }
spec:
  endpointSelector: { matchLabels: { app: psp-adapter } }
  egress:
    - toEndpoints: [ { matchLabels: { k8s:io.kubernetes.pod.namespace: kube-system, k8s-app: kube-dns } } ]
      toPorts: [ { ports: [ { port: "53", protocol: ANY } ], rules: { dns: [ { matchPattern: "*" } ] } } ]
    - toFQDNs: [ { matchName: "api.psp.example" }, { matchName: "acs.cardscheme.example" } ]
      toPorts: [ { ports: [ { port: "443", protocol: TCP } ] } ]
---
# Cilium egress gateway: PSP traffic leaves via a fixed IP for partner allow-lists
apiVersion: cilium.io/v2
kind: CiliumEgressGatewayPolicy
metadata: { name: psp-fixed-egress }
spec:
  selectors: [ { podSelector: { matchLabels: { app: psp-adapter } } } ]
  destinationCIDRs: ["203.0.113.0/24"]
  egressGateway: { nodeSelector: { matchLabels: { role: egress-gw } }, egressIP: "10.40.8.10" }
~~~`,
  dia: r`flowchart LR
  subgraph C1[Cluster A - Cilium, WireGuard]
    PA[psp-adapter] -->|FQDN policy| EG[Egress gateway node - fixed IP]
    PAY[payments-api] --> LED[ledger]
  end
  EG --> NAT[NAT / firewall - logged] --> PSP[api.psp.example]
  C1 <-->|Cluster Mesh, non-overlapping CIDRs| C2[Cluster B]
  HUB[Hubble flow logs] -.audit evidence.-> C1`,
  pts: [r`VPC-native, overlay and eBPF CNIs trade address space, integration and features.`, r`Plan non-overlapping pod and service CIDRs centrally with growth headroom.`, r`Default-deny egress with FQDN policies and stable egress IPs.`, r`Encrypt with mTLS and/or CNI WireGuard/IPsec.`, r`Connect clusters sparingly; flow logs provide audit evidence.`],
  ex: r`A card issuer needed a fixed IP for a scheme's allow-list; a Cilium egress gateway routed only the adapter pods through it, instead of exposing the whole cluster's NAT IPs.`,
  fu: [r`How do you migrate a live cluster from one CNI to another?`, r`mTLS mesh or WireGuard: which for PCI segmentation evidence?`],
  pit: [r`Overlapping pod CIDRs across clusters.`, r`Allowing all egress to the internet.`, r`VPC-native CNI on small subnets.`] },

{ id: 'q50', level: 'Principal', tags: ['principles', 'summary'],
  q: r`Summarise the Kubernetes principles you would enforce as Principal Engineer for a financial-services platform.`,
  a: r`"My Kubernetes principles fit on one page:

- **Use Kubernetes when it pays for itself**: many services and teams, a funded platform team; otherwise container PaaS.
- **Clusters are cattle**: defined as code, bootstrapped by GitOps, rebuilt routinely, upgraded quarterly in waves, never more than one minor behind.
- **Blast radius by design**: prod separate from non-prod, CDE in its own cluster and account, regions independent.
- **Git is the only change path**: GitOps, reviewed promotions of signed digests, read-only humans in production, break-glass recorded.
- **Secure by default**: SSO + least-privilege RBAC, restricted Pod Security, default-deny networking, workload identity, external secrets with KMS, signed images verified at admission, private API endpoints, audit logs to the SIEM.
- **Reliable by default**: correct probes, graceful shutdown with preStop, PDBs with maxUnavailable, topology spread, N-1 zone capacity, progressive delivery with automated analysis.
- **Right-sized and efficient**: requests from data, autoscaling bounded by downstream limits, Karpenter/Spot/ARM where safe, cost visible per team.
- **State lives in managed services** unless a strong team and mature operator justify otherwise.
- **Observable**: SLO alerts, OpenTelemetry traces, exported events, flow logs.
- **Admission and add-ons are critical infrastructure**: scoped, HA, monitored, chaos-tested."`,
  code: r`~~~text
Adoption      : Kubernetes only with scale + platform team; else ECS Fargate / Container Apps
Fleet         : IaC clusters, GitOps bootstrap, quarterly upgrade waves, N-1 max
Isolation     : prod vs non-prod clusters, CDE cluster + account, per-team namespaces with quotas
Change        : Argo CD/Flux, promote signed digests by PR, read-only prod, break-glass audited
Security      : SSO RBAC, PSA restricted, default-deny netpol, workload identity, ESO + KMS, cosign at admission
Reliability   : probes, preStop + drain, PDB maxUnavailable 1, topology spread, canary analysis
Efficiency    : VPA recommendations, bounded HPA/KEDA, Karpenter, Spot/ARM, OpenCost showback
State         : managed databases/queues by default; operators with drills when justified
Observability : SLO burn alerts, OTel Collector, event export, Hubble flows
Critical path : webhooks scoped + HA + VAP, monitored, chaos-tested
~~~`,
  pts: [r`Adopt Kubernetes only when it pays for itself.`, r`Clusters as cattle with GitOps and regular upgrades.`, r`Blast radius by design and Git as the only change path.`, r`Secure and reliable defaults enforced by the platform.`, r`Efficient, observable, with state in managed services and admission treated as critical.`],
  ex: r`Encoding these principles in the platform repo, standard chart and policy bundle meant new services were compliant by default and audits pulled evidence straight from Git and dashboards.`,
  fu: [r`Which principle would you enforce first in an inherited, messy estate?`],
  pit: [r`Principles without automation to enforce them.`] }
],
cheat: r`### Architecture
API server (only etcd client; authn → RBAC → mutating → validation → validating admission) · etcd (Raft majority, fsync-sensitive, ~1.5 MiB objects, 2 GiB default quota) · scheduler (filter → score → bind) · controllers reconcile desired vs actual (level-triggered) · kubelet + runtime + CNI on nodes · control plane down = no changes, pods keep running.

### Workloads
Deployment → ReplicaSet → Pods (maxSurge / maxUnavailable, minReadySeconds, no auto-rollback) · StatefulSet: stable names, headless DNS, PVC per replica · Job: indexed, backoffLimitPerIndex, podFailurePolicy · CronJob: concurrencyPolicy Forbid, startingDeadlineSeconds, timeZone · DaemonSet: per-node agents · native sidecars = init containers with restartPolicy Always.

### Health & shutdown
Startup protects slow starts · liveness restarts (no dependencies!) · readiness gates traffic · termination: endpoints removed and SIGTERM concurrently → preStop sleep 10-15 s → Kestrel drain (ShutdownTimeout) < terminationGracePeriodSeconds · app keep-alive > proxy keep-alive.

### Resources & scaling
Requests = scheduling, limits = cgroups · CPU limit → CFS throttling; memory limit → OOMKilled 137 · QoS Guaranteed / Burstable / BestEffort · HPA: ceil(current × metric / target), slow scale-down · KEDA for events, scale to zero · VPA recommend-only with HPA · Karpenter/CA pack by requests · PDB maxUnavailable 1 + unhealthyPodEvictionPolicy AlwaysAllow.

### Networking
Service = VIP + DNS over ready pods; per-connection balancing (gRPC needs client-side/mesh) · ndots:5 → use FQDN with trailing dot or NodeLocal DNSCache (5 s spikes = lost UDP) · NetworkPolicy needs a CNI; default deny + DNS egress; no L7/FQDN in core API · Gateway API: GatewayClass / Gateway (platform) / HTTPRoute (teams); ingress-nginx retiring.

### Security
RBAC additive; block create-pods, exec, escalate/bind/impersonate, system:masters · automount SA token off · PSA restricted: non-root, no escalation, drop ALL, RO root FS, seccomp · Secrets are base64 → KMS at rest + External Secrets + workload identity · cosign signatures verified at admission · webhooks: scoped, HA, short timeouts, exclude kube-system; prefer ValidatingAdmissionPolicy (CEL).

### Operations
GitOps (pull, self-heal, promote digests by PR) · Argo Rollouts/Flagger canaries with metric analysis · upgrades: ~3 minors/yr, ~14 months support, one minor at a time, kubelet ≤ 3 minors behind, scan removed APIs · DR = IaC + GitOps rebuild + data replication + Velero; warm standby for 1 h RTO · APF protects the API server from noisy clients.

### Say this
"Kubernetes is a reconciliation engine, not a deployment script." "Liveness must never check dependencies." "Base64 is not encryption." "Requests drive cost; limits drive throttling." "Clusters are cattle; Git is the only change path." "If you don't need CRDs and operators, use a PaaS."`
});
})(String.raw);
