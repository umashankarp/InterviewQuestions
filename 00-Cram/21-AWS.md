# AWS — Cram Sheet

> Tier 1 · Source: `21-AWS/` (8 modules, 4,078 lines) · Read: 20 min
> Focus: how services **connect**, and the decision frameworks — not per-service feature lists.
> **Version note:** AWS defaults, limits and prices change. Treat named figures as current planning inputs and verify them in the AWS documentation for the target region before committing a design.

---

## 1. The master request journey (be able to trace this end-to-end)

```
Client → Route 53 (DNS)  → CloudFront (edge cache, TLS, WAF)
       → ALB (L7, public subnet, target group health checks)
       → ECS/EKS task or EC2 (private subnet)
       → RDS/Aurora (private subnet, SG allows only the app SG)
       → S3 / DynamoDB via VPC Endpoint (never over the internet)
Cross-cutting: IAM role (no keys) · Secrets Manager · CloudWatch + X-Ray
```

---

## 2. VPC & Networking

- **CIDR** sizing matters — you cannot resize a VPC CIDR later (you can add secondary blocks). Plan for EKS: the VPC CNI gives **every pod a real VPC IP**, so IP exhaustion is a genuine design constraint.
- **Public vs private subnet is defined by the route table, not the name.** Public = has a route to an **Internet Gateway**. Private = routes `0.0.0.0/0` to a **NAT Gateway** (outbound only).
- **Security Group vs NACL** — deliberately redundant layers:
  | | Security Group | NACL |
  |---|---|---|
  | Level | instance/ENI | subnet |
  | State | **stateful** (return traffic auto-allowed) | **stateless** (need explicit outbound rule) |
  | Rules | allow only | allow **and deny** |
  - SGs can reference **other SGs** — that's the idiomatic way to say "only the app tier may reach the DB."
- **VPC Endpoints** — private access to AWS services with no NAT/internet. **Gateway endpoints (S3, DynamoDB) are free**; Interface endpoints (PrivateLink) cost per hour + per GB. **NAT Gateway data-processing charges are a top-3 surprise AWS bill item** — S3 traffic through NAT instead of a gateway endpoint is the classic waste.
- **AZ** = independent data centre. **Multi-AZ is the baseline for production.** Cross-AZ data transfer is charged.

---

## 3. Compute decision framework

| | Use when | Avoid when |
|---|---|---|
| **Lambda** | spiky/event-driven, <15 min, no long-lived connections | steady high traffic (cost), cold-start-sensitive, long jobs |
| **Fargate** | containers without node management | very cost-sensitive at steady scale, need DaemonSets/GPU |
| **ECS (EC2)** | AWS-native containers, simpler than K8s | need K8s ecosystem/portability |
| **EKS** | K8s ecosystem, portability, complex workloads | small team — you now own the K8s operational burden |
| **EC2** | licensing, legacy, custom kernel/agents | anything the above covers |

**ECS vs EKS — the defensible answer:** ECS if the team is small and the workload is AWS-only, because the operational surface is a fraction of EKS's. EKS when you need the Kubernetes ecosystem (operators, Helm, portability) or already have K8s skills. **The cost of EKS is not the $0.10/hr control plane — it's the people.**

**Edge choice:** **CloudFront** (global cache/static/TLS) → **API Gateway** (auth, throttling, usage plans, per-route Lambda) → **ALB** (L7 HTTP routing to containers/EC2, cheaper at scale) → **NLB** (L4, static IP, ultra-low latency, TCP/gRPC/WebSocket).

---

## 4. Auto Scaling & Load Balancing

- **ASG** — matches capacity to demand *and to failure* (replaces unhealthy instances). Target tracking > step scaling for most cases.
- **Target group health checks:** the timers must add up — `deregistration_delay` (default 300s) + health check interval × threshold. Get them wrong and every deploy drops requests.
- **Cross-zone load balancing:** on by default for ALB, **off by default for NLB** → traffic skew when AZs have unequal instance counts.
- **gRPC/WebSockets break naive LB setups** — they multiplex on one long-lived connection, so connection-level (L4) balancing pins all traffic to one target. Use ALB (request-level) or client-side LB.
- **Route 53 is not a failover mechanism you can bound in time** — TTLs and resolver caching make DNS failover minutes, not seconds. For fast failover use **Global Accelerator** (anycast IPs, sub-minute, health-checked).

---

## 5. IAM & Security

- **Evaluation logic:** **explicit Deny > explicit Allow > implicit deny (default)**. An SCP, permission boundary, or resource policy Deny cannot be overridden.
- **Policy types:** identity-based · resource-based (S3 bucket policy, KMS key policy) · permission boundary · **SCP** (org-wide ceiling) · session policy.
- **AssumeRole + STS** is the mechanism behind every "role": a **trust policy** says *who may assume*, the permission policy says *what they may do*. Cross-account access = trust the other account's principal.
- **Workload identity — never static keys.** EC2 → instance profile. ECS → task role. **EKS → IRSA (OIDC federation) or EKS Pod Identity.** Lambda → execution role. On-prem/CI → OIDC federation.
- **KMS envelope encryption** — you never encrypt the payload with the KMS key directly: KMS generates a **data key**, you encrypt data locally with it, and store the **encrypted data key** alongside. Reason: KMS has a 4KB payload limit and per-call cost/throttle; envelope encryption gives you unlimited size and one API call per object.
- **Secrets Manager vs Parameter Store vs IAM DB auth:**
  - Parameter Store = free tier, config + SecureString, no rotation.
  - Secrets Manager = **automatic rotation**, cross-region replication, costs per secret.
  - **IAM database authentication** = no stored password at all (best when supported) — short-lived token, but has a connection-rate limit.
- **Tenant isolation:** SGs and IAM alone are not enough — use **per-tenant IAM session policies / dynamic policy variables**, partition keys scoped by tenant, and **KMS key per tenant** for the strong version. Then name what has no detector: a silent cross-tenant read by an over-broad role.

---

## 6. Storage

- **S3 is a flat namespace** — "folders" are a UI fiction over key prefixes. Prefixes matter for performance (3,500 PUT / 5,500 GET **per prefix per second**).
- **Consistency:** S3 is now **strongly consistent** for read-after-write and list. (An older "eventual consistency" answer is out of date — do not say it.)
- **Storage classes:** Standard → Intelligent-Tiering (auto, best default for unknown patterns) → Standard-IA → One Zone-IA → Glacier Instant / Flexible / Deep Archive. **Lifecycle policies** automate the transition; **minimum storage durations** mean early deletion is charged.
- **Encryption:** SSE-S3 (AWS-managed, free) · **SSE-KMS** (auditable via CloudTrail, per-request KMS cost — use **S3 Bucket Keys** to cut it ~99%) · SSE-C / client-side (you hold the key).
- **Three distinct access mechanisms:** IAM policy (who) · **bucket policy** (resource-side, cross-account, enforce TLS/encryption) · **pre-signed URL** (time-limited, delegated, no AWS identity needed — the right answer for browser upload/download).
- **EBS is AZ-scoped.** That single fact drives multi-AZ database design — a volume cannot follow an instance to another AZ, so HA needs replication, not volume attachment. gp3 lets you provision IOPS independently of size.
- **EFS** = shared POSIX across AZs. Honest answer: **most workloads don't need it** — it's slower and pricier than S3 or EBS; use it only for genuine shared-filesystem semantics (legacy apps, shared content roots).

---

## 7. Databases

- **RDS Multi-AZ is HA, not scaling** — the standby serves no traffic; failover is a **DNS CNAME change taking ~60–120s**. Your .NET app must have connection retry (`EnableRetryOnFailure`) or it fails the whole window.
- **Read replicas** scale reads, asynchronous, **lag is real** → read-your-own-writes breaks. Route reads deliberately, not automatically.
- **Aurora is not "managed MySQL but faster":** compute is separated from a **distributed storage layer that replicates 6 ways across 3 AZs** and does redo-log-based replication. Consequences: failover in ~30s, replicas share storage (so near-zero replica lag), backups don't hit the instance, and storage auto-grows. **Aurora Serverless v2** scales capacity in fine increments.
- **DynamoDB:**
  - **Partition key choice is the whole design.** Throughput is per partition — "just add capacity" **cannot** fix a bad key.
  - **Hot partition / hot key** → add a **write-sharding suffix**, or use an on-demand table.
  - **Single-table design**, GSIs (own capacity, eventually consistent) vs LSIs (same partition key, strong reads, must be created with the table).
  - Strongly consistent reads cost 2× and are not available on GSIs.
- **ElastiCache — "the cache is not a database" is the recurring failure.** Redis for structures/persistence/replication; Memcached for simple multi-threaded cache. Plan for the cache being empty (a cold restart must not take the site down).
- **Choosing:** relational + transactions + joins → **RDS/Aurora**. Known access patterns + extreme scale + single-digit-ms → **DynamoDB**. Analytics → **Redshift**. Full-text → **OpenSearch**. Time-series → **Timestream**.

---

## 8. Serverless

- **Lambda execution model:** **Init phase** (cold: download, start runtime, run static constructors) then **Invoke phase**. Anything in a static field is reused across invocations — that's why you create `HttpClient`/SDK clients **outside** the handler.
- **Cold starts for .NET:** mitigate with **Provisioned Concurrency** (eliminates it, costs money), **ReadyToRun** compilation, trimming/NativeAOT, smaller deployment packages, and keeping the handler assembly lean. **SnapStart** exists for Java; for .NET the practical lever is R2R + provisioned concurrency.
- **Concurrency:** account-level ceiling (default 1,000) · **reserved** (guarantees *and* caps a function) · **provisioned** (pre-warmed). One runaway function can starve every other function in the account — reserved concurrency is the blast-radius control.
- **Lambda → RDS connection exhaustion:** each concurrent execution opens its own connection; 1,000 concurrent Lambdas = 1,000 connections and the DB dies. **RDS Proxy** pools and multiplexes them. This is a very common interview scenario.
- **Event source types decide error handling** — synchronous (API Gateway: caller sees the error), asynchronous (S3/SNS: 2 automatic retries then a DLQ/on-failure destination), poll-based (SQS/Kinesis: the batch is retried, and a poison message can block a Kinesis shard until it expires).
- **Memory is the CPU lever** — CPU scales with memory. More memory is often *cheaper* because the function finishes faster.
- **API Gateway REST vs HTTP API:** HTTP API is ~70% cheaper and lower latency; REST API has usage plans/API keys, request validation, WAF integration and private endpoints. Pick HTTP API unless you need a REST-only feature.
- **Step Functions** when you need **visible, durable orchestration** — retries, catch, parallel, wait states — instead of chaining Lambdas by hand. **Standard** (up to 1 year, exactly-once, priced per state transition) vs **Express** (≤5 min, at-least-once, priced by duration, high volume).

---

## 9. Messaging

| | Model | Replay | Ordering | Use |
|---|---|---|---|---|
| **SQS Standard** | queue, at-least-once | ✖ | best-effort | decoupling, work queues |
| **SQS FIFO** | queue, exactly-once *dedup* | ✖ | per message-group | ordered work (300 TPS, 3,000 batched) |
| **SNS** | pub/sub fan-out | ✖ | ✖ | notify many |
| **EventBridge** | **content-based routing** + schema registry | ✖ (archive+replay ✔) | ✖ | event bus, SaaS/AWS events |
| **Kinesis** | **sharded log** | **✔ (retention)** | per shard | streaming analytics, replay |
| **MSK** | managed Kafka | ✔ | per partition | you need Kafka specifically |

- **Choose the subscription shape by failure semantics.** SNS→SQS gives each consumer an independent durable buffer, retry policy and DLQ — usually best when consumers need isolation, controlled replay or long outages. SNS→Lambda is asynchronous and SNS retries delivery; configure a subscription DLQ and make the function idempotent, because messages can be discarded after retries are exhausted if no DLQ is attached.
- **SQS visibility timeout** must exceed processing time, or the message is redelivered while still being processed. **`maxReceiveCount`** on the redrive policy sends it to the DLQ.
- **Kinesis shard** = 1 MB/s or 1,000 records/s in, 2 MB/s out. **Partition key determines shard → hot shard** is the recurring failure.
- **Kinesis vs SQS — the decisive difference is replay** (and multiple independent consumers).
- **Outbox on AWS:** write the row + outbox entry in one RDS transaction → **DynamoDB Streams / DMS / Debezium-on-MSK** or a polling relay → SNS/EventBridge.

---

## 10. Containers on AWS (EKS)

- **Control plane** is AWS-managed (API server, etcd, across 3 AZs). **You manage** worker nodes, add-ons, upgrades, and everything you deploy.
- **Capacity:** managed node groups · self-managed · **Fargate profiles** (no nodes, but no DaemonSets, no GPU, per-pod pricing) · **Karpenter** (fast, right-sized just-in-time nodes — increasingly the default over Cluster Autoscaler).
- **VPC CNI: every pod is a real VPC citizen** with a VPC IP and SGs — great for security-group-per-pod, but **IP exhaustion is a real planning constraint** (prefix delegation helps).
- **A Kubernetes Secret is base64, not encryption.** Enable **envelope encryption with KMS** for etcd, or mount from Secrets Manager via the CSI driver.
- **IRSA** (OIDC federation between the cluster and IAM) or **EKS Pod Identity** — how a pod gets real AWS permissions without node-role over-grant.
- **Two independent scaling dimensions:** **HPA** scales *pods*; **Cluster Autoscaler/Karpenter** scales *nodes*. Confusing them is a common mistake.
- **AWS Load Balancer Controller** provisions an ALB from an `Ingress` / an NLB from a `Service type=LoadBalancer`. Use **target-type `ip`** so the LB talks to pods directly.

---

## 11. Observability, Cost & Well-Architected

- **CloudWatch** (logs, metrics, alarms, Logs Insights) · **CloudTrail** (immutable API audit — *who did what*) · **X-Ray** (distributed tracing — makes "slow" specific) · **Config** (resource compliance over time).
- **Alerts worth having:** ALB 5xx rate & target response time p99 · ASG unhealthy hosts · RDS CPU/connections/replica lag · SQS queue depth **and** age of oldest message · DLQ depth > 0 · Lambda throttles & error rate · **cost anomaly detection**.
- **Well-Architected — six pillars:** Operational Excellence · Security · Reliability · Performance Efficiency · Cost Optimization · **Sustainability**. Treat it as a standing review discipline, not a one-off questionnaire.
- **Cost levers, in order of impact:** right-sizing → **Savings Plans / Reserved Instances** → Spot for fault-tolerant work → S3 lifecycle/Intelligent-Tiering → **kill NAT Gateway data-processing with VPC endpoints** → reduce cross-AZ transfer → Graviton (~20% better price/performance) → log retention policies.
- **DR — the honest version, with RPO/RTO:**
  | Strategy | RPO / RTO | Cost |
  |---|---|---|
  | Backup & restore | hours | £ |
  | Pilot light | ~10s of min | ££ |
  | Warm standby | minutes | £££ |
  | Active-active (multi-region) | ~zero | ££££ |
  - **State the RPO/RTO as numbers, and say what you actually test.** An untested DR plan has an RTO of infinity.

---

## Top traps

1. Calling S3 eventually consistent (it's strongly consistent now).
2. RDS Multi-AZ described as read scaling.
3. Lambda + RDS without **RDS Proxy** → connection exhaustion.
4. "Just add capacity" to fix a hot DynamoDB partition.
5. S3 traffic through a NAT Gateway instead of a free gateway endpoint.
6. Kubernetes Secrets assumed to be encrypted.
7. SNS straight to Lambda with no SQS buffer.
8. Route 53 relied on for fast failover.
9. NLB cross-zone off → traffic skew.
10. Static IAM access keys anywhere in a workload.

---

## Interview Q&A — Lead / Principal

### Q1 · Cut the cloud bill by 30% *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"Finance says AWS spend is up 40% year on year. You have a quarter. Where do you start?"*

**Answer.** With attribution, not savings — I can't cut what I can't attribute. Cost allocation tags enforced at provisioning, Cost Explorer grouped by service and team, and Cost Anomaly Detection on. Very often the first finding is that 20% of spend belongs to something nobody owns.

Then in order of **effort-to-saving ratio**: **right-sizing** (most fleets are provisioned for a peak that never recurs) and killing idle resources — unattached EBS volumes, old snapshots, dev environments running at weekends. Then **Savings Plans or Reserved Instances** on the genuinely steady baseline, which is pure margin for a one-hour decision. Then **Graviton**, roughly 20% better price/performance for a rebuild and a test cycle on .NET. Then data transfer, which is where the surprises live: **S3 traffic routed through a NAT Gateway instead of a free gateway VPC endpoint** is a top-three waste item, plus cross-AZ chatter. Then **S3 lifecycle and Intelligent-Tiering**, and log retention, which quietly becomes one of the largest lines.

The part that makes it stick: a one-off cut regresses within two quarters. I'd want **cost visible per team on a dashboard they own**, cost anomaly alerts routed to the owning team rather than to finance, and a unit-economics metric — cost per transaction — so growth in spend is judged against growth in business rather than in absolute terms. And I'd say explicitly that some spend is correct: I'm not cutting multi-AZ redundancy to hit a number.

**Why it lands.** Attribution first, ordered by effort/saving, names the NAT/endpoint trap, and makes it durable with unit economics rather than a one-off.
**✗ Weak answer.** "Buy Reserved Instances" or "move to serverless."
**↳ Follow-ups.** What's your cost-per-transaction trend? What spend would you refuse to cut?

---

### Q2 · Lambda hits the database *(Lead)* ⭐⭐⭐⭐
**Asked as:** *"Our Lambda-based API works in test and exhausts database connections in production. Why?"*

**Answer.** Each concurrent Lambda execution is its own environment with its own connection — so concurrency *is* connection count. At 1,000 concurrent executions you're asking for 1,000 connections, and RDS won't give you that; in test you had concurrency of three and never saw it. Worse, connection establishment is expensive, so each cold invocation pays it and latency degrades exactly when load rises.

The fix is **RDS Proxy**, which pools and multiplexes connections so a thousand Lambdas share a small pool. Alongside that: **reserved concurrency** on the function as a blast-radius control — it caps this function and stops one runaway consuming the account-level ceiling and starving everything else. And create the SDK/database client **outside the handler** so it's reused across invocations in a warm environment, which people frequently get wrong.

The design question underneath: if this API is steady high-volume rather than spiky, Lambda may be the wrong compute choice — per-request pricing and the connection model both work against it. I'd check the traffic shape before optimising, because the honest answer might be "this should be a container."

**Why it lands.** Explains why test didn't catch it, names RDS Proxy *and* reserved concurrency, and questions the compute choice.
**✗ Weak answer.** "Increase `max_connections`" — moves the wall.
**↳ Follow-ups.** What does RDS Proxy cost you? When would you still pick Lambda here?

---

### Q3 · Multi-region DR — what do you actually commit to? *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"The regulator asks for our disaster recovery position. What do you tell them?"*

**Answer.** Two numbers and the evidence: **RPO** — how much data we may lose — and **RTO** — how long to recover. Anything else is narrative. Then which strategy those numbers buy: backup-and-restore is hours and cheap; pilot light is tens of minutes; warm standby is minutes and costs real money; active-active is near-zero and costs a lot. The honest framing is that the business chooses the number and engineering prices it, not the other way round.

The part that matters to a regulator, and the part most organisations fail: **an untested DR plan has an RTO of infinity.** So I'd commit to a tested figure — the date of the last failover exercise, what it actually measured, and what it found. Anything not exercised is a hypothesis. I'd also be explicit about what's *not* covered: a regional failover usually doesn't cover data corruption or a bad deploy replicated to both regions, which need point-in-time restore rather than failover — those are different failures with different recovery paths, and conflating them is how a DR plan gives false assurance.

Then the constraint that often dominates in finance: **data residency** may forbid replication to another region entirely, which caps your options regardless of budget.

**Why it lands.** Numbers before strategy, untested-equals-infinite, distinguishes failover from corruption recovery, and names residency as the real constraint.
**✗ Weak answer.** "We're multi-AZ and we back up nightly."
**↳ Follow-ups.** When did you last fail over? What's your recovery path for logical corruption?

---

### Quick-fire (30 seconds each)

- **"Trace a request through your AWS architecture."** → Route 53 resolves to CloudFront, which terminates TLS at the edge and serves cached static content; dynamic requests go to an ALB in public subnets, which health-checks and routes to ECS tasks in private subnets. Those assume a task role — no static keys — read secrets from Secrets Manager, hit Aurora over a security group that only allows the app's SG, and reach S3 through a gateway VPC endpoint so the traffic never touches the NAT Gateway. CloudWatch and X-Ray instrument every hop.
- **"ECS or EKS?"** → ECS if the team is small and the workload is AWS-only — the operational surface is a fraction of EKS's and the integration is tighter. EKS when I need the Kubernetes ecosystem or portability across clouds. The real cost of EKS isn't the control-plane fee, it's the people needed to run upgrades, CNI, add-ons and RBAC — so I'd only take that on if there's an existing platform team.
- **"How does a pod get AWS permissions?"** → IRSA or EKS Pod Identity — the cluster has an OIDC provider, the service account is annotated with a role ARN, and the pod federates to STS for short-lived credentials. The alternative people reach for is granting the node role, which means every pod on that node inherits the permissions — that's the over-grant I'd flag in a review.

---

**Go deeper:** `21-AWS/01`–`08` · **Related:** [[22-Azure]], [[23-Kubernetes]], [[14-System-Design-Core]], [[38-APIGateway-ServiceMesh-IAM]]
