# Azure (vs AWS) — Cram Sheet

> Tier 2 · Source: `22-Azure/` (8 modules, 3,519 lines) · Read: 10 min
> **Learn this as a diff against [[21-AWS]].** Focus on the genuine divergences, not the mapping table.

---

## 1. Service mapping (quick recall)

| AWS | Azure |
|---|---|
| EC2 / ASG | VM / **VM Scale Set** |
| VPC / Security Group / NACL | **VNet** / **NSG** (subnet *or* NIC) |
| ALB / NLB | **Application Gateway** (L7, **WAF bundled**) / **Load Balancer** (L4) |
| CloudFront + Route 53 | **Front Door** / **Traffic Manager** (DNS) + CDN |
| IAM | **Entra ID** + **Azure RBAC** |
| KMS + Secrets Manager | **Key Vault** (both in one) |
| Instance profile / IRSA | **Managed Identity** |
| S3 | **Blob Storage** |
| EBS / EFS | **Managed Disks** / **Azure Files** |
| RDS / Aurora | **Azure SQL Database** / **SQL Managed Instance** |
| DynamoDB | **Cosmos DB** |
| Lambda / Step Functions | **Functions** / **Durable Functions** |
| SQS+SNS / EventBridge / Kinesis | **Service Bus** / **Event Grid** / **Event Hubs** |
| ECS / EKS / Fargate | **Container Apps** / **AKS** / (ACI) |
| CloudWatch + X-Ray | **Azure Monitor + Application Insights** |

---

## 2. The genuine divergences (this is what gets asked)

1. **Resource Groups** — a structural container with **no AWS equivalent**. Lifecycle, RBAC scope and deletion boundary. Management Group → Subscription → Resource Group → Resource.
2. **Azure RBAC inherits hierarchically down that scope chain** — the single most consequential difference from AWS IAM, which is flat and policy-attachment-based. A role assigned at the subscription applies to everything beneath it. (And Azure **Deny assignments** are rare — AWS's explicit-deny model is more expressive.)
3. **Availability Zones vs Availability Sets** — two distinct, **non-interchangeable** mechanisms. Availability *Set* = fault/update domains **within one datacentre** (protects against rack and host-patch failure). Availability *Zone* = separate datacentres. **You need zones for real DC-failure resilience; a set is not a substitute.**
4. **Managed Identity is genuinely better than AWS's model in one respect** — **user-assigned** identities can be shared across resources and pre-created, so the identity outlives the resource. System-assigned is tied to the resource lifecycle.
5. **Key Vault combines KMS and Secrets Manager** in one service (keys, secrets, certificates).
6. **Storage redundancy is explicit and named:** **LRS** (3 copies, one DC) · **ZRS** (across zones) · **GRS** (async to a paired region) · **RA-GRS** (+ readable secondary) · **GZRS**. AWS just says "11 nines in the region" — Azure makes you choose, and that choice is a cost/RPO decision.
7. **Cosmos DB's five consistency levels** — the most consequential divergence from DynamoDB: **Strong · Bounded Staleness · Session · Consistent Prefix · Eventual.** **Session is the default and usually the right answer** (read-your-own-writes per session). Bounded staleness lets you bound lag by *time or version count* — genuinely useful and has no DynamoDB equivalent.
8. **Cosmos DB native multi-region writes (multi-master)** — a real capability beyond DynamoDB Global Tables, with configurable conflict resolution (LWW or a custom stored procedure).
9. **Request Units (RUs)** — Cosmos bills a single normalised currency for reads/writes/queries, provisioned or serverless or autoscale. Different mental model from DynamoDB's separate RCU/WCU.
10. **Azure Functions requires a hosting-plan choice** Lambda doesn't: **Consumption** (scale to zero, cold starts) · **Premium** (pre-warmed, VNet) · **Dedicated/App Service** · **Flex Consumption**. Picking the plan *is* the architecture decision.
11. **Durable Functions use a replay model** — the orchestrator function is **re-executed from the start** on every resumption, replaying history. Therefore **orchestrator code must be deterministic**: no `DateTime.Now`, no `Guid.NewGuid()`, no random, no direct I/O — use the durable context equivalents. This is the non-obvious requirement, and it has no Step Functions equivalent because Step Functions is declarative rather than imperative.
12. **Event Grid's retry-then-*loss* behaviour** — push-based with bounded retries, then the event is **dropped** unless you configured dead-lettering. Sharper edge than SNS→SQS. The robust pattern: Event Grid → **Service Bus** for slow consumers, so they pull at their own pace against broker-retained durability.
13. **Service Bus combines queues *and* topics/subscriptions** in one service; **Sessions** give FIFO/ordering (analogous to SQS FIFO message groups).
14. **Container Apps is a genuine third tier with no AWS equivalent** — serverless containers with **scale-to-zero**, built on **KEDA** (event-driven autoscaling) and **Dapr**. Decision ladder: **Container Apps → AKS → (ACI)**, matching complexity to need.
15. **Dapr is materially broader than App Mesh** — a portable microservices toolkit (state store, pub/sub, bindings, secrets, service invocation) where the backing store is a **deployment-time config**, not a code dependency. Portability is real; the cost is another abstraction and runtime to operate.
16. **Paired regions** — an Azure platform concept with no AWS equivalent: pairs get sequential updates and prioritised recovery. Your DR region choice should usually follow the pair.
17. **Well-Architected has five pillars in Azure** (no Sustainability pillar) vs AWS's six.
18. **Azure Hybrid Benefit** — bring existing Windows Server / SQL Server licences. A major, frequently-forgotten cost lever for .NET shops, and often the real reason a bank is on Azure.
19. **Azure SQL Database HA is architecturally different from RDS Multi-AZ** — built-in, with a separated compute/storage design in the higher tiers (Business Critical uses an Always On-style replica set). **Elastic Pools** (shared DTU/vCore across many databases) have no RDS equivalent and are the standard multi-tenant SaaS answer.

---

## Top traps

1. Availability Set used where a zone is required.
2. Forgetting Azure RBAC inherits down the scope hierarchy.
3. Cosmos consistency left at Strong (cost/latency) or assumed Eventual (Session is the default).
4. Event Grid used for a slow consumer → bounded retries, then loss.
5. Non-deterministic code in a Durable Functions orchestrator.
6. Consumption plan chosen for a latency-sensitive API (cold starts).
7. LRS chosen when the RPO requires GRS.
8. NSG associated at the wrong level (subnet vs NIC).
9. System-assigned identity where the identity needs to outlive the resource.
10. Ignoring Azure Hybrid Benefit in a cost comparison.

---

## 30-second answers

- **"How is Azure RBAC different from AWS IAM?"** → Azure is hierarchical and Entra-ID-centric: assignments made at a management group, subscription or resource group **inherit downward**, so scope is the primary control. AWS is flat — policies attach to principals and resources, and explicit Deny beats everything, which makes it more expressive for guardrails. Practically: in Azure I reason about *where* I assign the role; in AWS I reason about *which* policies combine, and I rely on SCPs and explicit deny for ceilings.
- **"Which Cosmos DB consistency level?"** → Session by default — it gives read-your-own-writes within a session at low cost, which is what most applications actually need. Strong is available but forces a latency and RU cost and constrains multi-region writes. The one people miss is Bounded Staleness, which lets you bound lag by time or version count — genuinely useful when you need "no more than 5 seconds stale" as a contract, and DynamoDB has no equivalent.
- **"Why might a bank choose Azure over AWS?"** → Usually not a technology argument. It's the existing Microsoft estate — Entra ID already being the corporate identity provider, Windows and SQL Server licences portable via Azure Hybrid Benefit, and established enterprise agreements. Add paired regions and sovereign/regional coverage for data residency. I'd frame it as a total-cost and integration decision, not a capability one, because on capability the two are close enough that the estate dominates.

---

**Go deeper:** `22-Azure/01`–`08` · **Related:** [[21-AWS]], [[23-Kubernetes]], [[38-APIGateway-ServiceMesh-IAM]]
