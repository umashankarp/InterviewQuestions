(function (r) {
registerTopic('21-aws', {
related: ['22-azure', '23-kubernetes', '08-dynamodb'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['global-infrastructure', 'request-journey'],
  q: r`Trace an HTTPS request from a browser to a .NET API on AWS and back, naming every hop. Where do Regions, Availability Zones and edge locations fit?`,
  a: r`**Building blocks**
- **Region** (for example {{eu-west-1}}): an independent geographic area with its own control planes. Data does not leave it unless you replicate it.
- **Availability Zone**: one or more isolated data centres inside a Region (at least three per Region), connected by low-latency links. **Design for AZ failure by default.**
- **Edge locations**: hundreds of points of presence for CloudFront, Route 53 and Global Accelerator.
- **Shared responsibility**: AWS secures the cloud (hardware, hypervisor, managed-service internals); you secure what you put in it — IAM, network rules, data, OS patching on EC2, application code.

**The journey (be ready to draw it):**
1. **Route 53** resolves {{api.bank.com}} (alias record) to the CloudFront distribution.
2. The browser opens TLS to the nearest **CloudFront** edge; **WAF** rules (rate limits, managed rule groups) run there; **Shield Standard** absorbs volumetric DDoS.
3. On a cache miss CloudFront forwards to the **ALB** origin over HTTPS.
4. The **ALB** in public subnets (three AZs) terminates TLS, matches a listener rule (host/path), and picks a healthy target in the target group.
5. The **ECS/EKS task** in a private subnet receives the request on Kestrel.
6. The app gets credentials from its **task role**, reads a cached secret from **Secrets Manager**, checks **ElastiCache**, and queries **Aurora/RDS** through **RDS Proxy** in private data subnets.
7. Asynchronous work goes to **SQS/EventBridge**; AWS API calls go through **VPC endpoints**; outbound internet calls go through a **NAT Gateway**.
8. The response returns along the same path; **CloudWatch** (metrics, logs) and **X-Ray/ADOT** traces record every hop.

Interviewers listen for where TLS terminates, which subnets are public, and how the app gets credentials without keys.`,
  code: r`~~~text
User --DNS--> Route 53 (alias, latency/failover policy)
     --TLS--> CloudFront edge (WAF, Shield, cache)  --HTTPS--> ALB (public subnets, 3 AZs)
     --HTTP/2--> ECS task / EKS pod (private app subnets, task role)
            |-> Secrets Manager (VPC endpoint, cached)     |-> ElastiCache (cache-aside)
            |-> RDS Proxy -> Aurora writer (private data subnets, Multi-AZ)
            |-> SQS / EventBridge (VPC endpoint)            '-> NAT Gateway -> PSP on the internet
Telemetry: CloudWatch Logs/Metrics, ADOT -> X-Ray; audit: CloudTrail
~~~`,
  dia: r`flowchart LR
  U[Browser] --> R53[Route 53]
  U --> CF[CloudFront + WAF]
  CF --> ALB[ALB - public subnets]
  subgraph VPC[VPC across 3 AZs]
    ALB --> APP[ECS tasks - private subnets]
    APP --> RP[RDS Proxy]
    RP --> DB[(Aurora Multi-AZ)]
    APP --> EC[(ElastiCache)]
    APP --> VE[VPC endpoints: SQS, Secrets Manager]
    APP --> NAT[NAT Gateway]
  end
  NAT --> PSP[External PSP]`,
  pts: [r`Region contains 3+ AZs; edge locations serve CloudFront and Route 53.`, r`Design for AZ failure always, Region failure by business need.`, r`TLS at the edge and the ALB; apps live in private subnets.`, r`Credentials come from roles; AWS APIs via endpoints, internet via NAT.`, r`Shared responsibility: you own IAM, data, network config and code.`],
  ex: r`At a card issuer, drawing this path in an incident review revealed TLS was terminated at the ALB and re-sent as plain HTTP across AZs, which PCI scope did not allow; end-to-end TLS to the tasks fixed the finding.`,
  fu: [r`Where would you terminate TLS for PCI workloads?`, r`What happens on this path when one AZ fails?`],
  pit: [r`Putting application instances in public subnets.`, r`Forgetting how the app obtains credentials.`],
  tip: r`Draw the path left to right and name the subnet tier of every box; that alone separates a Senior answer from a recall answer.` },

{ id: 'q2', level: 'Basic', tags: ['vpc', 'networking', 'subnets'],
  q: r`Design a production VPC: CIDR planning, public/private/data subnets, Internet and NAT Gateways. What actually makes a subnet "public"?`,
  a: r`**CIDR planning first.** Choose a VPC range (for example {{10.20.0.0/16}}) that does **not overlap** with on-premises networks, other VPCs or partner networks — overlaps block peering and Transit Gateway routing later and are painful to fix. Allocate from a central IPAM plan.

**Three tiers in each of three AZs:**
- **Public subnets** — ALB and NAT Gateways only. Small (/24).
- **Private app subnets** — ECS tasks, EKS pods, EC2. Large (/20 or bigger) because EKS's VPC CNI gives every pod a VPC IP.
- **Private data subnets** — RDS, ElastiCache, no internet route at all.

**What makes a subnet public:** its **route table** has {{0.0.0.0/0 -> igw-...}}. Nothing else — not its name. Instances also need a public IP to be reachable. A **private** subnet routes {{0.0.0.0/0}} to a **NAT Gateway** (outbound only) or has no default route at all.

**NAT design:** one NAT Gateway **per AZ**, each private subnet routing to the NAT in its own AZ. A single NAT is a single point of failure for the whole VPC's egress and incurs cross-AZ data charges.

**Add from day one:** gateway endpoints for S3 and DynamoDB, interface endpoints for the AWS APIs you call, VPC Flow Logs, and default security groups with no rules.`,
  code: r`~~~hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  name    = "payments-prod"
  cidr    = "10.20.0.0/16"
  azs     = ["eu-west-1a", "eu-west-1b", "eu-west-1c"]
  public_subnets   = ["10.20.0.0/24", "10.20.1.0/24", "10.20.2.0/24"]        # ALB, NAT
  private_subnets  = ["10.20.16.0/20", "10.20.32.0/20", "10.20.48.0/20"]    # app tier / EKS pods
  database_subnets = ["10.20.64.0/24", "10.20.65.0/24", "10.20.66.0/24"]    # no internet route
  enable_nat_gateway     = true
  one_nat_gateway_per_az = true                                             # no single egress SPOF
  enable_flow_log        = true
}
~~~`,
  dia: r`flowchart TB
  IGW[Internet Gateway]
  subgraph AZa[AZ a]
    PubA[Public subnet: ALB, NAT-a]
    AppA[Private app subnet]
    DataA[Data subnet: RDS primary]
  end
  subgraph AZb[AZ b]
    PubB[Public subnet: ALB, NAT-b]
    AppB[Private app subnet]
    DataB[Data subnet: RDS standby]
  end
  IGW --- PubA
  IGW --- PubB
  AppA -->|0.0.0.0/0| PubA
  AppB -->|0.0.0.0/0| PubB
  AppA --> DataA
  AppB --> DataB`,
  pts: [r`Plan non-overlapping CIDRs centrally.`, r`Public, private app and data tiers in 3 AZs.`, r`A subnet is public because its route table points to an IGW.`, r`One NAT Gateway per AZ.`, r`Endpoints and Flow Logs from day one.`],
  ex: r`A bank that started with {{10.0.0.0/16}} in every account had to re-IP 40 VPCs before connecting them through Transit Gateway; central IPAM prevented a repeat.`,
  fu: [r`How big should EKS pod subnets be?`, r`What breaks if the only NAT Gateway's AZ fails?`],
  pit: [r`Calling a subnet private because of its name.`, r`A single NAT Gateway for all AZs.`] },

{ id: 'q3', level: 'Basic', tags: ['security-groups', 'nacl', 'network-security'],
  q: r`Security Groups versus Network ACLs: how do they differ, and how do you use them together in a three-tier application?`,
  a: r`| | Security Group | Network ACL |
|---|---|---|
| Attached to | ENI (instance, task, pod, RDS) | subnet |
| State | **stateful** — return traffic allowed automatically | **stateless** — must allow return (ephemeral ports) |
| Rules | allow only | allow and deny, numbered, first match wins |
| References | other security groups | CIDRs only |
| Typical role | the **primary**, fine-grained control | coarse guard rails |

**Security-group chaining** is the key design: rules reference other groups, not IP ranges, so they keep working as tasks scale and IPs change:
- {{alb-sg}}: 443 from CloudFront's managed prefix list (or the internet);
- {{app-sg}}: 8080 **from {{alb-sg}} only**;
- {{db-sg}}: 5432/1433 **from {{app-sg}} only**.

**NACLs**: leave mostly default (allow all) and use them for explicit **denies** — a known-bad CIDR, or "data subnets never talk to the internet" as defence in depth. Complex NACLs cause outages because of the stateless return-traffic rule.

**Senior points:** security groups have quotas (rules per group, groups per ENI); use **managed prefix lists** for shared CIDRs; audit with Config rules ({{restricted-ssh}}, no {{0.0.0.0/0}} on databases); **no SSH at all** — use SSM Session Manager.`,
  code: r`~~~hcl
resource "aws_security_group" "app" {
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]   # only the ALB may reach the app
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
resource "aws_security_group" "db" {
  vpc_id = module.vpc.vpc_id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]   # only the app tier may reach Aurora
  }
}
~~~`,
  pts: [r`Security groups: stateful, allow-only, on ENIs.`, r`NACLs: stateless, allow/deny, per subnet.`, r`Chain security groups by reference, not IPs.`, r`NACLs for coarse denies only.`, r`No SSH; Session Manager instead.`],
  ex: r`A NACL change that allowed port 443 inbound but not the ephemeral return range took down outbound PSP calls for 40 minutes; the team moved all fine-grained rules back into security groups.`,
  fu: [r`Why do stateless rules need ephemeral ports?`, r`How do you restrict the ALB to CloudFront only?`],
  pit: [r`Database security groups open to the VPC CIDR.`, r`Complex NACLs as the main firewall.`] },

{ id: 'q4', level: 'Basic', tags: ['iam', 'policy-evaluation'],
  q: r`Explain IAM: principals, roles, policy types, and the policy evaluation logic, including cross-account access.`,
  a: r`**Principals**
- **Root user**: lock away with MFA, never used day to day.
- **IAM users**: avoid for humans (use IAM Identity Center/SSO) and for workloads (use roles).
- **Roles**: assumed via STS for **temporary credentials** — by services (ECS tasks, Lambda), federated humans, other accounts, or Kubernetes pods.

**Policy types**
- **Identity-based** (attached to a role/user) and **resource-based** (S3 bucket policies, KMS key policies, SQS queue policies).
- **Guard rails**: **SCPs** (Organizations: the maximum for every principal in an account), **permission boundaries** (maximum for a role), **session policies**.
- **Trust policy**: who may assume a role.

**Evaluation logic**
1. Default **deny**.
2. Any applicable **explicit Deny** → denied. Full stop.
3. Otherwise the request needs an **Allow** that every guard-rail layer permits: the SCP allows it, the boundary allows it, and an identity or resource policy grants it.
4. **Cross-account**: the caller's identity policy must allow the action **and** the target's resource policy (or role trust policy) must allow the caller. Both sides.
5. **KMS** is stricter: the key policy must grant access (directly or by delegating to IAM).

**Least privilege in practice:** specific actions and resource ARNs, **conditions** ({{aws:SourceVpce}}, {{aws:PrincipalTag}}, {{kms:ViaService}}, {{aws:RequestedRegion}}), IAM Access Analyzer to generate policies from CloudTrail activity and flag external access.`,
  code: r`~~~json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ReadPaymentsQueue", "Effect": "Allow",
      "Action": ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility"],
      "Resource": "arn:aws:sqs:eu-west-1:111122223333:payments-capture" },
    { "Sid": "OnlyFromOurVpcEndpoint", "Effect": "Deny", "Action": "s3:*",
      "Resource": ["arn:aws:s3:::payments-docs", "arn:aws:s3:::payments-docs/*"],
      "Condition": { "StringNotEquals": { "aws:SourceVpce": "vpce-0abc123" } } }
  ]
}
~~~`,
  dia: r`flowchart TD
  A[Request] --> B{Explicit Deny anywhere?}
  B -->|yes| D[DENY]
  B -->|no| C{SCP allows?}
  C -->|no| D
  C -->|yes| E{Permission boundary allows?}
  E -->|no| D
  E -->|yes| F{Identity or resource policy allows?}
  F -->|no| D
  F -->|yes| G[ALLOW]`,
  pts: [r`Roles and temporary credentials, not users and keys.`, r`Identity, resource, SCP, boundary and session policies.`, r`Explicit deny wins; every guard rail must allow.`, r`Cross-account needs both sides to allow.`, r`Conditions and Access Analyzer for least privilege.`],
  ex: r`A cross-account S3 read failed for days because only the bucket policy was changed; the caller's role also needed the Allow.`,
  fu: [r`How does an SCP differ from a permission boundary?`, r`Why are KMS key policies special?`],
  pit: [r`"Action": "*" on "Resource": "*" for application roles.`, r`Assuming an SCP grants permissions.`] },

{ id: 'q5', level: 'Basic', tags: ['s3', 'storage', 'encryption'],
  q: r`Explain S3's core guarantees and features: consistency, durability, storage classes, encryption and access control. How do you let clients upload files without proxying bytes through your API?`,
  a: r`**Guarantees**
- Object storage with a flat key namespace (prefixes, not folders); designed for **11 nines durability** across multiple AZs (except One Zone classes).
- **Strong read-after-write consistency** for PUTs, overwrites, deletes and LIST (since December 2020) — no more eventual-consistency workarounds.
- Thousands of requests per second **per prefix**; spread hot keys across prefixes for extreme rates.

**Storage classes and lifecycle:** Standard → Intelligent-Tiering / Standard-IA → Glacier Instant/Flexible/Deep Archive, with **lifecycle rules** for transitions and expiry; mind minimum storage durations and retrieval fees.

**Encryption:** SSE-S3 is on by default; **SSE-KMS** with a customer-managed key gives key-policy control and CloudTrail audit of every decrypt (enable **S3 Bucket Keys** to cut KMS request cost); DSSE-KMS for dual-layer requirements.

**Access control:** **Block Public Access** on (account level), IAM policies, bucket policies (deny non-TLS, require the VPC endpoint), access points for many consumers, **Object Ownership = bucket owner enforced** (ACLs disabled).

**Direct uploads:** the API authorises the user, then issues a **pre-signed PUT URL** (or multipart upload parts) scoped to one key under the tenant's prefix, short expiry, required content type. The browser uploads directly; an S3 event triggers scanning and validation; the API records the document only after verification. The API never handles 50 MB request bodies.`,
  code: r`~~~csharp
public async Task<UploadTicket> CreateUploadAsync(Guid tenantId, Guid applicationId)
{
    var key = $"{tenantId}/{applicationId}/{Guid.NewGuid():N}.pdf";
    var url = await _s3.GetPreSignedURLAsync(new GetPreSignedUrlRequest
    {
        BucketName = "loan-docs-prod",
        Key = key,
        Verb = HttpVerb.PUT,
        Expires = DateTime.UtcNow.AddMinutes(5),
        ContentType = "application/pdf",
        ServerSideEncryptionMethod = ServerSideEncryptionMethod.AWSKMS
    });
    await _db.Documents.AddAsync(new Document(key, tenantId, Status: "PendingScan"));
    await _db.SaveChangesAsync();
    return new UploadTicket(url, key);   // browser PUTs directly to S3
}
~~~`,
  pts: [r`11 nines durability; strong read-after-write consistency.`, r`Lifecycle rules across storage classes.`, r`SSE-KMS with Bucket Keys for control and audit.`, r`Block Public Access, bucket-owner-enforced, TLS-only policies.`, r`Pre-signed URLs keep large bytes out of your API.`],
  ex: r`A mortgage portal moved 30 MB document uploads from the API to pre-signed URLs and cut API memory by 70% while removing a class of timeout errors.`,
  fu: [r`How do you limit upload size with pre-signed URLs?`, r`What does S3 Bucket Keys change in KMS cost?`],
  pit: [r`Streaming large uploads through the API tier.`, r`Long-lived pre-signed URLs.`] },

{ id: 'q6', level: 'Basic', tags: ['compute', 'decision-framework'],
  q: r`Lambda, ECS Fargate, EKS, EC2 or App Runner: how do you choose compute for a new .NET service?`,
  a: r`| Option | Choose when | Avoid when |
|---|---|---|
| **Lambda** | event-driven, spiky or low traffic; short work (≤ 15 min); minimal ops | steady high load (cost), long jobs, strict p99 with cold starts unmitigated |
| **ECS on Fargate** | containerised .NET, AWS-committed, small platform team | you need Kubernetes ecosystem features, GPUs or daemonsets |
| **EKS** | many teams, Kubernetes standard, GitOps, operators, portability | no platform team to own upgrades and add-ons |
| **EC2** | full control: Windows/.NET Framework, licensing (SQL Server), special hardware | you want minimal operations |
| **App Runner / Beanstalk** | simple web apps, quick start | complex networking or large estates |

**Decision drivers, in order:**
1. **Workload shape**: event-driven and spiky (Lambda) vs steady request/response (containers) vs long-running/stateful.
2. **Team capability**: who patches, upgrades and is on call. EKS needs a platform team.
3. **Cost at the expected load**: Lambda is cheap at low utilisation and expensive at sustained high utilisation; compute the crossover.
4. **Latency**: .NET cold starts (mitigate with NativeAOT, SnapStart, provisioned concurrency).
5. **Portability and standards** across the organisation.

A common Principal answer: **ECS Fargate as the default** for .NET services in an AWS-only estate, **Lambda for glue and event handlers**, **EKS only with a platform team** and a reason, EC2 for legacy Windows workloads being migrated. Record it in an ADR.`,
  code: r`~~~csharp
// AWS CDK (C#): the default paved road - Fargate service behind an ALB
var svc = new ApplicationLoadBalancedFargateService(this, "PaymentsApi", new ApplicationLoadBalancedFargateServiceProps
{
    Cluster = cluster, Cpu = 1024, MemoryLimitMiB = 2048, DesiredCount = 3,
    RuntimePlatform = new RuntimePlatform { CpuArchitecture = CpuArchitecture.ARM64 },   // Graviton
    TaskImageOptions = new ApplicationLoadBalancedTaskImageOptions
    { Image = ContainerImage.FromEcrRepository(repo, "1.42.0"), ContainerPort = 8080 },
    CircuitBreaker = new DeploymentCircuitBreaker { Rollback = true }
});
~~~`,
  pts: [r`Decide by workload shape, team, cost, latency and standards.`, r`Lambda for events and spiky loads; mind cold starts and sustained-load cost.`, r`Fargate as a low-ops container default.`, r`EKS needs a platform team and a reason.`, r`EC2 for legacy Windows and licensing needs.`],
  ex: r`A team's Lambda-based pricing API cost four times a two-task Fargate service once traffic became steady at 300 RPS; they moved it and kept Lambda for event handlers.`,
  fu: [r`Where is the Lambda vs Fargate cost crossover for your workload?`, r`What does EKS cost you beyond the control-plane fee?`],
  pit: [r`Choosing EKS because it is fashionable.`, r`Ignoring the steady-state cost of Lambda.`] },

{ id: 'q7', level: 'Intermediate', tags: ['alb', 'nlb', 'api-gateway', '502'],
  q: r`ALB, NLB or API Gateway in front of .NET services? And why do healthy services behind an ALB return random 502s?`,
  a: r`**Choosing**
- **ALB (L7)**: HTTP/1.1, HTTP/2, gRPC, host/path/header routing, TLS termination, WAF, OIDC auth, weighted target groups (canaries). The default for container APIs.
- **NLB (L4)**: TCP/UDP/TLS, very high throughput, **static IPs**, client source-IP preservation, PrivateLink service endpoints. Long-lived HTTP/2 connections pin to targets — use client-side balancing for gRPC behind NLB.
- **API Gateway**: managed API features — per-client throttling and usage plans, API keys, JWT/Lambda authorisers, request validation, direct Lambda/service integrations. Per-request pricing and limits (a 29-second default integration timeout, payload limits) make it expensive or constraining for high-volume container backends.

**Random 502s: the keep-alive race.** The ALB reuses idle connections to targets. If the **target closes an idle connection first**, the ALB may send a request on a socket the server is closing → 502 with target status "-" in access logs. Rule: **backend keep-alive timeout > ALB idle timeout** (60 s default). Kestrel's default keep-alive (130 s) is safe — the bug appears when someone lowers it, or when a sidecar/proxy in between (nginx, Envoy, Node) has a shorter idle timeout.

**Deploy-time 502/503s:** the task stops before the ALB stops sending to it. Fix: deregistration delay (for example 30 s) plus graceful shutdown in the app longer than it, readiness failing first, and ECS stop timeout above both.`,
  code: r`~~~csharp
builder.WebHost.ConfigureKestrel(k =>
{
    k.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(75);      // must exceed ALB idle timeout (60 s)
    k.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(30);
});
builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(45));   // > deregistration delay (30 s)
// ECS container stopTimeout 60 s > app shutdown 45 s > target group deregistration_delay 30 s
~~~`,
  pts: [r`ALB for HTTP/gRPC routing, WAF and auth.`, r`NLB for L4, static IPs, PrivateLink.`, r`API Gateway for managed API features at moderate volume.`, r`502s: backend keep-alive must exceed ALB idle timeout.`, r`Deploy 5xx: align deregistration delay and graceful shutdown.`],
  ex: r`A team lowered Kestrel's keep-alive to 30 s "to save sockets" and got 0.2% 502s under load; restoring it above 60 s removed them.`,
  fu: [r`How do you read ALB access logs for 502 vs 504?`, r`gRPC behind NLB: what goes wrong?`],
  pit: [r`Retrying 502s blindly on non-idempotent POSTs.`, r`Using API Gateway for 50k RPS internal traffic without costing it.`] },

{ id: 'q8', level: 'Intermediate', tags: ['route53', 'dns', 'global-accelerator'],
  q: r`Explain Route 53 routing policies and health checks. How fast is DNS failover really, and when do you use Global Accelerator instead?`,
  a: r`**Routing policies**
- **Simple**; **weighted** (canary 5/95, blue/green); **latency** (nearest Region by measured latency); **failover** (primary/secondary with health checks); **geolocation** (by country, for residency or localisation); **geoproximity**; **multivalue** (up to 8 healthy records).
- **Alias records** point at AWS resources (ALB, CloudFront, S3) at the zone apex, free of query charges.
- **Health checks** probe endpoints from multiple locations, or follow a CloudWatch alarm (for "the app is up but payments fail").

**Real failover time** = health-check detection (interval × failure threshold, ~30–90 s) + record **TTL** + **resolver and client caching** — and some clients (JVMs, old SDKs, corporate resolvers) cache far longer than the TTL. Expect minutes with a long tail.

**Global Accelerator**: two static **anycast IPs** advertised from AWS's edge; traffic enters the AWS backbone at the nearest edge and is routed to healthy regional endpoints (ALB/NLB). Failover happens **inside AWS's network in seconds**, with no DNS caching involved. Also improves latency over the public internet and gives partners fixed IPs to allow-list.

**For tight, auditable RTO**, use **Route 53 Application Recovery Controller** routing controls (manual or automated switch with readiness checks) or Global Accelerator, and design clients to retry across endpoints.`,
  code: r`~~~hcl
resource "aws_route53_health_check" "eu" {
  fqdn              = "api-eu.bank.com"
  type              = "HTTPS"
  resource_path     = "/health/ready"
  request_interval  = 10
  failure_threshold = 3
}
resource "aws_route53_record" "primary" {
  zone_id = var.zone_id
  name    = "api.bank.com"
  type    = "A"
  set_identifier  = "eu-primary"
  health_check_id = aws_route53_health_check.eu.id
  failover_routing_policy { type = "PRIMARY" }
  alias {
    name                   = aws_lb.eu.dns_name
    zone_id                = aws_lb.eu.zone_id
    evaluate_target_health = true
  }
}
~~~`,
  pts: [r`Weighted, latency, failover, geolocation, multivalue policies.`, r`Alias records at the apex for AWS resources.`, r`DNS failover = detection + TTL + caching: minutes.`, r`Global Accelerator: anycast static IPs, seconds failover.`, r`ARC routing controls for controlled regional switching.`],
  ex: r`A broker's DR test measured 11 minutes of DNS failover for corporate clients despite a 60 s TTL; Global Accelerator brought it under 1 minute.`,
  fu: [r`How would you do a 5% canary across Regions?`, r`Why prefer manual routing controls for DR?`],
  pit: [r`Promising a 1-minute RTO based on a 60 s TTL.`, r`Health checks that only test "process is up".`] },

{ id: 'q9', level: 'Intermediate', tags: ['workload-identity', 'irsa', 'credentials'],
  q: r`How does a .NET application get AWS credentials on ECS, EKS, Lambda and EC2 without access keys? Explain the SDK credential chain, task vs execution roles, IRSA and EKS Pod Identity.`,
  a: r`**The AWS SDK for .NET resolves credentials through a chain**: environment variables → shared profile → **ECS container credentials** (task role) → web-identity token (**IRSA**) / **EKS Pod Identity** endpoint → EC2 **instance profile** (IMDSv2). Code just creates clients; nothing about keys appears in config.

**ECS:**
- **Task role** — what *your application* can do (read this queue, write this bucket).
- **Execution role** — what the *ECS agent* needs: pull from ECR, write logs, fetch secrets to inject as environment variables. Keep them separate.

**EKS:**
- **IRSA**: a Kubernetes service account is annotated with a role ARN; the pod gets a projected OIDC token; the SDK calls {{AssumeRoleWithWebIdentity}}. Requires an OIDC provider per cluster and a trust policy per role.
- **EKS Pod Identity** (newer, simpler): an association (cluster, namespace, service account → role) managed in the EKS API; an agent on each node vends credentials; trust policy is generic, so roles are reusable across clusters.
- Never let pods use the **node role** — block IMDS from pods (hop limit 1) so a compromised pod cannot borrow node credentials.

**Lambda**: the execution role. **EC2**: instance profile with **IMDSv2 required**.

**Humans**: IAM Identity Center (SSO) with short sessions, not IAM users.`,
  code: r`~~~csharp
// Program.cs - no keys anywhere; the default chain finds the task role / IRSA / Pod Identity
builder.Services.AddDefaultAWSOptions(builder.Configuration.GetAWSOptions());
builder.Services.AddAWSService<IAmazonSQS>();
builder.Services.AddAWSService<IAmazonS3>();
~~~
~~~yaml
# EKS Pod Identity association (eksctl) - service account -> IAM role
iam:
  podIdentityAssociations:
    - namespace: payments
      serviceAccountName: capture-worker
      roleARN: arn:aws:iam::111122223333:role/payments-capture-worker
~~~`,
  pts: [r`SDK credential chain picks up role credentials automatically.`, r`ECS: task role for the app, execution role for the agent.`, r`EKS: IRSA or Pod Identity per service account.`, r`Block pods from the node role via IMDS hop limit.`, r`IMDSv2 required on EC2; SSO for humans.`],
  ex: r`A pentest showed every EKS pod could read all S3 buckets through the node role; per-service-account Pod Identity roles plus IMDS hop limit 1 closed it.`,
  fu: [r`IRSA vs Pod Identity: which would you standardise on?`, r`How do you audit which role a pod used?`],
  pit: [r`Access keys in appsettings.json or Kubernetes Secrets.`, r`Giving the task role the execution role's permissions.`] },

{ id: 'q10', level: 'Intermediate', tags: ['kms', 'encryption', 'envelope'],
  q: r`Explain KMS envelope encryption, key types and key policies. How would you encrypt sensitive fields in a .NET payments service?`,
  a: r`**Why envelope encryption:** KMS encrypts at most 4 KB directly and every call is a network round trip with request quotas. So:
1. call {{GenerateDataKey}} → KMS returns a **plaintext data key** and the same key **encrypted under the KMS key**;
2. encrypt data locally (AES-256-GCM) with the plaintext key, then discard it from memory;
3. store the **encrypted data key** next to the ciphertext;
4. to decrypt, call KMS {{Decrypt}} on the small encrypted key, then decrypt locally.
Benefits: unlimited data size, local speed, central access control and **CloudTrail audit of every key use**; rotating the KMS key does not require re-encrypting data (old key material is retained).

**Key types:** AWS-owned (invisible), AWS-managed ({{aws/s3}}; no policy control), **customer-managed keys** (key policy, grants, rotation, cross-account use, disable/schedule deletion) — required for most regulated data. **Multi-Region keys** share key material across Regions for DR.

**Key policies** are the primary control: unlike most resources, IAM alone is not enough unless the key policy delegates to the account. Separate **key administrators** from **key users**; use {{kms:ViaService}} and encryption context conditions.

**Field-level encryption in .NET:** the AWS Encryption SDK handles data-key caching, encryption context (for example tenant and record id, bound into the ciphertext and logged in CloudTrail) and message format. Cache data keys briefly to stay under KMS request quotas.`,
  code: r`~~~csharp
var dk = await _kms.GenerateDataKeyAsync(new GenerateDataKeyRequest
{
    KeyId = "alias/payments-pii",
    KeySpec = DataKeySpec.AES_256,
    EncryptionContext = new() { ["tenant"] = tenantId, ["field"] = "holderName" }   // must match on decrypt; audited
});
var key = dk.Plaintext.ToArray();
try
{
    var nonce = RandomNumberGenerator.GetBytes(12);
    var plain = Encoding.UTF8.GetBytes(holderName);
    var cipher = new byte[plain.Length]; var tag = new byte[16];
    using (var gcm = new AesGcm(key, 16)) gcm.Encrypt(nonce, plain, cipher, tag);
    return new EncryptedField(cipher, nonce, tag, EncryptedKey: dk.CiphertextBlob.ToArray());
}
finally { CryptographicOperations.ZeroMemory(key); }
~~~`,
  dia: r`sequenceDiagram
  participant App as Payments service
  participant KMS as AWS KMS
  participant DB as Database
  App->>KMS: GenerateDataKey(alias/payments-pii, context)
  KMS-->>App: plaintext key + encrypted key
  App->>App: AES-GCM encrypt field, wipe plaintext key
  App->>DB: store ciphertext + encrypted key
  Note over App,KMS: decrypt path: KMS Decrypt(encrypted key) then local AES-GCM decrypt`,
  pts: [r`KMS protects small data keys; data is encrypted locally.`, r`Store the encrypted data key with the ciphertext.`, r`Customer-managed keys with key policies for regulated data.`, r`Encryption context binds and audits usage.`, r`Cache data keys to respect KMS quotas.`],
  ex: r`A payments team hit KMS throttling at 6,000 decrypts per second until they used the Encryption SDK's data-key cache with a 5-minute limit.`,
  fu: [r`How does crypto-shredding work with per-tenant keys?`, r`What happens to old data when a KMS key rotates?`],
  pit: [r`Calling KMS Encrypt on whole documents.`, r`Key policies that let application roles administer keys.`] },

{ id: 'q11', level: 'Intermediate', tags: ['secrets-manager', 'parameter-store', 'configuration'],
  q: r`Secrets Manager, Parameter Store or IAM database authentication: how do you manage secrets and configuration for .NET services, including rotation?`,
  a: r`| | Secrets Manager | Parameter Store | IAM DB auth |
|---|---|---|---|
| Purpose | credentials needing rotation | configuration, simple secrets | remove DB passwords |
| Rotation | built-in (Lambda rotation, managed for RDS) | none built in | tokens expire in 15 min |
| Cross-Region replication | yes | no | n/a |
| Cost | per secret + API calls | standard tier free | free |
| Engines | any | any | RDS/Aurora MySQL and PostgreSQL (not SQL Server) |

**Rotation without outages:** use the **alternating-users** strategy (two DB users, rotate the inactive one) or the managed single-user rotation with tolerance for brief failures; applications must **re-read** the secret on authentication failure instead of caching it forever. RDS can manage the master password in Secrets Manager directly.

**In .NET:**
- cache secrets ({{AWSSDK.SecretsManager.Caching}} or the configuration provider with a reload interval) — never call the API per request;
- for ECS, inject secrets as environment variables via the execution role (simple, but rotation needs a task restart) or read them at runtime (rotation-friendly);
- on EKS, the Secrets Store CSI driver with the AWS provider mounts secrets as files;
- **IAM DB auth** for PostgreSQL: generate a token ({{RDSAuthTokenGenerator}}) as the password; watch the new-connection rate limits and use pooling.

**Configuration** (feature flags, URLs) belongs in Parameter Store or AppConfig, not in Secrets Manager.`,
  code: r`~~~csharp
// Npgsql + IAM auth: password is a 15-minute token, regenerated per physical connection
var builder = new NpgsqlDataSourceBuilder("Host=payments.cluster-xyz.eu-west-1.rds.amazonaws.com;Database=payments;Username=payments_app;SSL Mode=VerifyFull");
builder.UsePeriodicPasswordProvider((settings, ct) =>
    ValueTask.FromResult(RDSAuthTokenGenerator.GenerateAuthToken(RegionEndpoint.EUWest1, settings.Host!, 5432, settings.Username!)),
    successRefreshInterval: TimeSpan.FromMinutes(10), failureRefreshInterval: TimeSpan.FromSeconds(10));
await using var dataSource = builder.Build();

// SQL Server on RDS: Secrets Manager with caching instead
var cache = new SecretsManagerCache(new AmazonSecretsManagerClient(), new SecretCacheConfiguration { CacheItemTTL = 300_000 });
var secret = JsonSerializer.Deserialize<DbSecret>(await cache.GetSecretString("prod/payments/sql"))!;
~~~`,
  pts: [r`Secrets Manager for rotating credentials; Parameter Store for config.`, r`IAM DB auth removes passwords for MySQL/PostgreSQL.`, r`Rotation strategy plus apps that re-read on auth failure.`, r`Cache secrets; never fetch per request.`, r`Env-var injection is simple but needs restarts on rotation.`],
  ex: r`Monthly password rotation caused 3 minutes of login failures until the app re-read the secret on SQL error 18456 and rotation switched to alternating users.`,
  fu: [r`How do you rotate a secret used by 40 services?`, r`What are IAM DB auth's connection-rate limits?`],
  pit: [r`Fetching the secret on every request.`, r`Caching a rotated password forever.`] },

{ id: 'q12', level: 'Intermediate', tags: ['rds', 'aurora', 'failover', 'dotnet'],
  q: r`RDS Multi-AZ versus Aurora: how do they replicate and fail over, what does a .NET application experience during failover, and how do you make it resilient?`,
  a: r`**RDS Multi-AZ (instance):** a synchronous standby in another AZ with its own storage. On failure, AWS promotes the standby and flips the DNS endpoint; typically **1–2 minutes** (SQL Server can be longer). The standby serves no reads. **Multi-AZ DB clusters** (MySQL/PostgreSQL) add two readable standbys and faster failover.

**Aurora:** compute separated from a **shared distributed storage volume** — 6 copies across 3 AZs, writes acknowledged by 4 of 6. Replicas read the same volume, so failover is promoting a replica, typically **under 30 seconds**. Up to 15 replicas; cluster (writer) and reader endpoints; Serverless v2; Global Database for cross-Region.

**What the application sees:** existing connections break; new connections fail until DNS points to the new writer; in-flight transactions roll back; cached DNS can point at the old writer (now a reader or gone).

**Resilience in .NET:**
- EF Core **execution strategy** ({{EnableRetryOnFailure}}) — retries transient errors; wrap explicit transactions in {{strategy.ExecuteAsync}};
- **idempotent writes** so a retried transaction cannot double-post;
- **RDS Proxy**: holds client connections and reconnects behind the scenes; failover often drops to seconds and pools connections for Lambda/bursty apps;
- short connect timeouts, pooled connections, **MultiSubnetFailover=True** for SQL Server;
- the AWS Advanced JDBC/ODBC wrappers have topology-aware failover; for .NET, RDS Proxy plus retries is the common approach;
- alarms on failover events and test them ({{reboot --force-failover}}).`,
  code: r`~~~csharp
builder.Services.AddDbContextPool<PaymentsDb>(o => o.UseNpgsql(
    builder.Configuration.GetConnectionString("Payments"),          // RDS Proxy endpoint
    npg => npg.EnableRetryOnFailure(maxRetryCount: 6, maxRetryDelay: TimeSpan.FromSeconds(5), errorCodesToAdd: null)
              .CommandTimeout(15)));

// explicit transactions must run inside the execution strategy so the whole unit retries
var strategy = db.Database.CreateExecutionStrategy();
await strategy.ExecuteAsync(async () =>
{
    await using var tx = await db.Database.BeginTransactionAsync();
    db.Postings.Add(posting);                     // idempotent: unique (PaymentId, LegType)
    db.Outbox.Add(OutboxMessage.For(posting));
    await db.SaveChangesAsync();
    await tx.CommitAsync();
});
~~~`,
  dia: r`flowchart LR
  APP[.NET tasks] --> PX[RDS Proxy]
  PX --> W[Aurora writer AZ-a]
  PX -.after failover.-> R1[Replica AZ-b promoted]
  W --- VOL[(Shared storage: 6 copies, 3 AZs)]
  R1 --- VOL
  R2[Replica AZ-c] --- VOL`,
  pts: [r`RDS Multi-AZ: synchronous standby, DNS flip, 1–2 min.`, r`Aurora: shared 6-way storage, replica promotion, under 30 s.`, r`Apps see dropped connections and rolled-back transactions.`, r`Execution strategy, idempotent writes, RDS Proxy.`, r`Test failovers and alarm on them.`],
  ex: r`Monthly forced failovers in a staging environment exposed a service that cached the writer IP; after the fix, production failovers caused 8 seconds of retries and zero failed payments.`,
  fu: [r`Why must explicit transactions run inside the execution strategy?`, r`When would you choose RDS SQL Server over Aurora PostgreSQL?`],
  pit: [r`Retrying non-idempotent transactions.`, r`Long DNS caching in the client.`] },

{ id: 'q13', level: 'Intermediate', tags: ['elasticache', 'redis', 'valkey', 'caching'],
  q: r`Design caching with ElastiCache for a .NET API: engine choice (Valkey/Redis OSS/Memcached), cluster mode, failover behaviour, and how the StackExchange.Redis client should be configured.`,
  a: r`**Engine choice**
- **Valkey** (the open-source Redis fork, supported since 2024) or **Redis OSS**: data structures, replication, Multi-AZ failover, persistence options. Valkey is priced lower on ElastiCache and is the default choice for new clusters.
- **Memcached**: multi-threaded, no replication, no persistence. Only for a pure, losable cache of simple strings.
- **ElastiCache Serverless**: no node sizing; scales automatically; billed by data stored and ECPUs. Good for spiky or unknown load; check the cost at steady high volume.

**Topology**
- **Cluster mode disabled**: one shard (primary + up to 5 replicas). Simple, but writes are capped by one node.
- **Cluster mode enabled**: data split across up to hundreds of shards by hash slot (16,384 slots). Scale writes horizontally; multi-key commands must hit keys in the same slot (use hash tags such as {{cust:{42}:profile}}).
- **Multi-AZ with automatic failover**: a replica in another AZ is promoted when the primary fails. The client sees **connection errors for a few seconds to tens of seconds**, then the primary endpoint points to the new node.

**Patterns**
- **Cache-aside** is the default: read cache, on miss read the database, set with a TTL. Add **jitter** to TTLs to avoid synchronized expiry, and use a per-key lock or request coalescing to stop a **stampede** on hot keys.
- **Write path**: update the database, then **delete** the key (not set it), so a racing reader cannot pin stale data for a whole TTL.
- The cache is **never the source of truth for money**. Balances, limits and idempotency records live in the database; the cache holds derived, rebuildable data.

**StackExchange.Redis**
- One **{{ConnectionMultiplexer}}** per process (singleton); it is thread-safe and multiplexes all commands.
- Use the **configuration endpoint** (cluster mode) or **primary endpoint**; set {{abortConnect=false}} so startup survives a failover; enable TLS ({{ssl=true}}) because in-transit encryption should be on; use AUTH or IAM authentication.
- Timeouts: set {{syncTimeout}}/{{asyncTimeout}} to a few hundred milliseconds so a slow cache **degrades to the database** instead of holding threads.
- Watch for **thread-pool starvation** symptoms in timeout messages ({{WORKER: Busy=...}}) — the classic .NET cause of "Redis timeouts" that are really app problems.`,
  code: r`~~~csharp
// Program.cs - singleton multiplexer, fail-soft settings
var opts = ConfigurationOptions.Parse(builder.Configuration["Redis:Endpoint"]!); // clustercfg.xxx.cache.amazonaws.com:6379
opts.Ssl = true;
opts.AbortOnConnectFail = false;      // survive startup during a failover
opts.ConnectTimeout = 2000;
opts.SyncTimeout = opts.AsyncTimeout = 300; // a slow cache must not stall requests
builder.Services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(opts));

public sealed class FxRateCache(IConnectionMultiplexer mux, IFxRateRepository repo)
{
    private readonly IDatabase _db = mux.GetDatabase();

    public async Task<decimal> GetRateAsync(string pair, CancellationToken ct)
    {
        try
        {
            var cached = await _db.StringGetAsync($"fx:{pair}");
            if (cached.HasValue) return decimal.Parse(cached!, CultureInfo.InvariantCulture);
        }
        catch (RedisException) { /* degrade to the database; emit a metric */ }

        var rate = await repo.GetRateAsync(pair, ct);
        var ttl = TimeSpan.FromSeconds(30 + Random.Shared.Next(0, 10)); // jitter
        _ = _db.StringSetAsync($"fx:{pair}", rate.ToString(CultureInfo.InvariantCulture), ttl, flags: CommandFlags.FireAndForget);
        return rate;
    }
}
~~~`,
  dia: r`flowchart LR
  API[.NET API task] -->|1 GET key| P[(Primary - AZ a)]
  API -->|2 miss: query| DB[(Aurora)]
  API -->|3 SET with TTL + jitter| P
  P -->|async replication| R1[(Replica - AZ b)]
  P -->|async replication| R2[(Replica - AZ c)]
  R1 -.promoted on failover.-> P`,
  pts: [r`Valkey or Redis OSS for features and failover; Memcached only for a simple losable cache.`, r`Cluster mode enabled scales writes; multi-key ops need hash tags.`, r`Cache-aside, TTL jitter, stampede protection, delete-on-write.`, r`One singleton ConnectionMultiplexer, TLS, short timeouts, abortConnect=false.`, r`The cache is never the source of truth for money.`],
  ex: r`A brokerage's quote API kept answering during an ElastiCache failover because cache errors fell through to Aurora; p99 rose from 12 ms to 40 ms for 20 seconds and no request failed.`,
  fu: [r`How do you prevent a cache stampede on a hot key at expiry?`, r`When is ElastiCache Serverless more expensive than provisioned nodes?`],
  pit: [r`Creating a ConnectionMultiplexer per request.`, r`Treating "Redis timeout" errors as a Redis problem when the thread pool is starved.`, r`Storing balances only in the cache.`] },

{ id: 'q14', level: 'Intermediate', tags: ['sqs', 'queues', 'visibility-timeout', 'dlq'],
  q: r`Explain SQS in depth: Standard versus FIFO, visibility timeout, long polling, DLQs and redrive. How do you write a correct .NET consumer?`,
  a: r`**Standard vs FIFO**
| | Standard | FIFO |
|---|---|---|
| Delivery | at-least-once; duplicates possible | exactly-once *processing* within a 5-minute deduplication window |
| Ordering | best effort | strict within a **message group** |
| Throughput | nearly unlimited | 300 API calls/s per action (3,000 msgs/s with batching); high-throughput mode goes much higher |
| Use | work queues, fan-in | per-account or per-order ordered commands |

FIFO's dedup only covers **producer retries inside 5 minutes**. It does not protect against a consumer that processes a message, crashes before deleting it, and processes it again. **Consumers must still be idempotent.**

**The lifecycle**
1. {{ReceiveMessage}} (use **long polling**, {{WaitTimeSeconds=20}}, to cut empty receives and cost).
2. The message becomes **invisible** for the **visibility timeout** (default 30 s, max 12 h).
3. On success the consumer calls {{DeleteMessage}} with the **receipt handle**.
4. If it is not deleted in time, it becomes visible again and is redelivered; {{ApproximateReceiveCount}} increments.
5. After {{maxReceiveCount}} receives the **redrive policy** moves it to the **DLQ**. **DLQ redrive** moves it back after a fix.

**Correct consumer rules**
- Set visibility timeout to about **6x** the typical processing time, and **extend** it ({{ChangeMessageVisibility}}) for long jobs; otherwise a slow message is processed twice in parallel.
- Delete **after** the side effect commits. Make the side effect idempotent (inbox table or conditional write keyed by message id or business key).
- Process batches of up to 10, delete in batches, but handle **per-message** failure.
- Retention is 4 days by default (max 14). An alarm on **{{ApproximateAgeOfOldestMessage}}** detects a stuck consumer long before data is lost.
- Payload limit is now **1 MiB** (raised from 256 KiB in 2025); use the **claim-check** pattern (S3 pointer) for anything larger or sensitive.
- Encrypt with SSE-SQS or SSE-KMS; restrict access with the queue policy and a VPC endpoint.`,
  code: r`~~~csharp
public sealed class SettlementConsumer(IAmazonSQS sqs, ISettlementHandler handler, ILogger<SettlementConsumer> log) : BackgroundService
{
    private const string QueueUrl = "https://sqs.eu-west-1.amazonaws.com/111122223333/settlement-commands";

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var resp = await sqs.ReceiveMessageAsync(new ReceiveMessageRequest
            {
                QueueUrl = QueueUrl, MaxNumberOfMessages = 10, WaitTimeSeconds = 20, // long polling
                VisibilityTimeout = 120, MessageSystemAttributeNames = ["ApproximateReceiveCount"]
            }, ct);

            foreach (var m in resp.Messages ?? [])
            {
                try
                {
                    await handler.HandleAsync(m.MessageId, m.Body, ct);     // idempotent: inbox keyed by MessageId
                    await sqs.DeleteMessageAsync(QueueUrl, m.ReceiptHandle, ct); // delete only after commit
                }
                catch (PermanentFailureException ex)
                {
                    log.LogError(ex, "Poison message {Id}", m.MessageId);    // let redrive move it to the DLQ
                }
                catch (Exception ex)
                {
                    log.LogWarning(ex, "Transient failure {Id}; will be redelivered", m.MessageId);
                }
            }
        }
    }
}
~~~`,
  dia: r`sequenceDiagram
  participant P as Producer
  participant Q as SQS queue
  participant C as Consumer
  participant D as DLQ
  P->>Q: SendMessage
  C->>Q: ReceiveMessage - long poll 20s
  Q-->>C: message, invisible for visibility timeout
  C->>C: process + commit idempotently
  C->>Q: DeleteMessage receiptHandle
  Note over Q,C: if not deleted in time it reappears
  Q->>D: after maxReceiveCount receives`,
  pts: [r`Standard is at-least-once; FIFO orders per message group and dedups producer retries for 5 minutes.`, r`Visibility timeout must exceed processing time; extend it for long work.`, r`Delete after the side effect commits; consumers are idempotent regardless of queue type.`, r`Long polling, batching, DLQ with maxReceiveCount, redrive after fixes.`, r`Alarm on age of oldest message, not just depth.`],
  ex: r`A refund processor with a 30-second visibility timeout and 45-second PSP calls issued duplicate refunds; raising the timeout and keying refunds on an idempotency key fixed it.`,
  fu: [r`How does FIFO throughput scale with message groups?`, r`What happens to ordering in FIFO when one message in a group goes to the DLQ?`],
  pit: [r`Believing FIFO means the consumer never sees duplicates.`, r`Deleting the message before the database commit.`, r`Short polling in a tight loop.`] },

{ id: 'q15', level: 'Intermediate', tags: ['sns', 'eventbridge', 'fan-out', 'events'],
  q: r`SNS, EventBridge or SQS? Design fan-out of a PaymentCaptured event to five consumers, and explain filtering, ordering, delivery guarantees and failure handling for each option.`,
  a: r`**What each one is**
- **SQS**: a queue; one logical consumer group per queue. Not a fan-out mechanism on its own.
- **SNS**: push pub/sub. A topic delivers to subscribers (SQS, Lambda, HTTPS, email/SMS). Very high throughput, low latency, **message filtering** on attributes or body. SNS FIFO topics give ordering when paired with SQS FIFO queues.
- **EventBridge**: an event bus with **rules** matching on any part of the JSON event (content-based filtering, prefix/numeric/exists matching), **input transformation**, **schema registry**, **archive and replay**, cross-account buses, SaaS partner sources, plus **Pipes** (point-to-point source to target) and **Scheduler**.

**The standard fan-out pattern: SNS (or EventBridge) to one SQS queue per consumer.** Each consumer owns its queue, its DLQ, its retry rate and its scaling. Pushing straight from SNS to Lambda or HTTPS couples the consumer's availability to delivery.

**Choosing**
| Need | Choose |
|---|---|
| Highest throughput, lowest latency, simple attribute filters | SNS + SQS |
| Rich content filtering, many teams, cross-account routing, replay | EventBridge |
| Ordered per key | SNS FIFO + SQS FIFO, or Kinesis/MSK |
| Replay of history for new consumers | Kinesis/MSK (EventBridge archive covers modest cases) |

**Guarantees and failure**
- Both SNS and EventBridge are **at-least-once**; duplicates and (for standard) reordering happen. Consumers dedupe on the event id.
- EventBridge retries delivery to a target for up to **24 hours** with backoff, then sends to the rule's **DLQ** if configured — without a DLQ the event is dropped.
- SNS retries per delivery policy; configure a **subscription DLQ** (SQS) for undeliverable messages.
- EventBridge adds some latency (typically tens to hundreds of milliseconds) and has per-Region PutEvents quotas — check them for high-volume streams.

**Publishing reliably** still needs the **transactional outbox**: write the event in the same database transaction as the state change, then relay to SNS/EventBridge. A direct publish after commit loses events when the process dies between the two.`,
  code: r`~~~json
// EventBridge rule: EU card captures above 10,000 to the AML screening queue
{
  "source": ["com.bank.payments"],
  "detail-type": ["PaymentCaptured"],
  "detail": {
    "region": ["EU"],
    "method": ["card"],
    "amountMinor": [{ "numeric": [">=", 1000000] }]
  }
}
~~~
~~~csharp
// Outbox relay publishes to EventBridge with the outbox id as the event id for consumer dedup
await events.PutEventsAsync(new PutEventsRequest
{
    Entries = [ new PutEventsRequestEntry {
        EventBusName = "payments", Source = "com.bank.payments", DetailType = "PaymentCaptured",
        Detail = JsonSerializer.Serialize(new { eventId = row.Id, paymentId, region = "EU", method = "card", amountMinor })
    } ]
}, ct); // check FailedEntryCount: PutEvents is partially successful by design
~~~`,
  dia: r`flowchart LR
  S[Payments service] --> O[(Outbox table)]
  O --> R[Outbox relay]
  R --> EB{{EventBridge bus: payments}}
  EB -->|rule: all| Q1[(ledger queue)]
  EB -->|rule: all| Q2[(notifications queue)]
  EB -->|rule: EU and amount at least 10k| Q3[(AML queue)]
  EB -->|rule: card| Q4[(rewards queue)]
  EB -->|cross-account| B2{{Data platform bus}}
  Q1 --> D1[(ledger DLQ)]`,
  pts: [r`Fan out with SNS or EventBridge into one SQS queue per consumer.`, r`SNS: throughput and latency; EventBridge: content filtering, cross-account, archive/replay.`, r`Everything is at-least-once; dedupe on event id.`, r`Configure DLQs on rules and subscriptions or events are dropped.`, r`Use an outbox to publish reliably; PutEvents can partially fail.`],
  ex: r`A card issuer replaced point-to-point HTTP calls with an EventBridge bus; adding an AML consumer became one rule in the compliance account instead of a payments release.`,
  fu: [r`How do you version event schemas on EventBridge?`, r`Why check FailedEntryCount on PutEvents?`],
  pit: [r`Subscribing Lambda directly to SNS for critical processing with no queue in between.`, r`No DLQ on EventBridge targets.`, r`Publishing after commit without an outbox.`] },

{ id: 'q16', level: 'Intermediate', tags: ['lambda', 'cold-start', 'dotnet', 'concurrency'],
  q: r`How does Lambda run .NET code? Explain the execution environment lifecycle, cold starts and how to reduce them (Native AOT, SnapStart, provisioned concurrency), and the concurrency model.`,
  a: r`**Execution environment lifecycle**
1. **Init**: Lambda creates a micro-VM (Firecracker), downloads the package, starts the runtime, and runs your static/constructor code (DI container, SDK clients, config). This is the **cold start**.
2. **Invoke**: the handler runs, one event at a time **per environment**.
3. The environment is **frozen** between invocations and **reused** for later ones; it can be destroyed at any time.
4. **Shutdown** after idleness or scaling in.

**Consequences:** initialise clients once outside the handler and reuse them; never assume local state survives; {{/tmp}} (512 MB default, up to 10 GB) is per environment.

**.NET cold starts** come from runtime start-up, JIT compilation and reflection-heavy DI/serialisation. Typical managed .NET 8 cold start is several hundred ms to over a second depending on dependencies and memory.
- **Memory = CPU**: more memory (up to 10,240 MB) gives proportionally more CPU; 1,024-2,048 MB often lowers both latency and cost.
- **Native AOT**: compiles ahead of time, removes the JIT; cold starts drop substantially. Needs trimming-safe code and source-generated {{System.Text.Json}}; reflection-heavy libraries may break.
- **SnapStart** (supported for .NET 8+ managed runtimes since late 2024): snapshots the initialised environment and resumes from it. Beware uniqueness: anything generated at init (random seeds, connections, cached credentials) is cloned across environments — use runtime hooks to refresh it.
- **Provisioned concurrency**: pre-initialised environments, billed while allocated. Use for strict latency SLOs; combine with Application Auto Scaling on a schedule.
- Trim dependencies; ReadyToRun if not AOT; avoid scanning assemblies at start-up.

**Concurrency model**
- Concurrency = in-flight requests ≈ requests/s × duration (s). 500 rps × 0.2 s = 100 environments.
- The default **account quota is 1,000 concurrent executions per Region** (raisable), shared by all functions. **Reserved concurrency** guarantees and caps a function; it protects other functions from a runaway one and protects a database from too many connections.
- Burst scaling: each function can add up to 1,000 concurrent environments every 10 seconds.
- Beyond the limit, synchronous calls get **429 throttles**; asynchronous events are retried internally.

Interview angle: Lambda in front of RDS without **RDS Proxy** multiplies connections by concurrency and exhausts the database.`,
  code: r`~~~csharp
// Native AOT Lambda with source-generated JSON; clients created once per environment
using Amazon.Lambda.Core;
using Amazon.Lambda.RuntimeSupport;
using Amazon.Lambda.Serialization.SystemTextJson;

var dynamo = new AmazonDynamoDBClient();           // init phase: reused across invocations

var handler = async (FxQuoteRequest req, ILambdaContext ctx) =>
{
    var item = await dynamo.GetItemAsync("fx-rates",
        new() { ["pair"] = new AttributeValue(req.Pair) });
    return new FxQuoteResponse(req.Pair, decimal.Parse(item.Item["rate"].S, CultureInfo.InvariantCulture));
};

await LambdaBootstrapBuilder.Create(handler, new SourceGeneratorLambdaJsonSerializer<AppJsonContext>())
    .Build().RunAsync();

public record FxQuoteRequest(string Pair);
public record FxQuoteResponse(string Pair, decimal Rate);
[JsonSerializable(typeof(FxQuoteRequest))][JsonSerializable(typeof(FxQuoteResponse))]
public partial class AppJsonContext : JsonSerializerContext;
// csproj: <PublishAot>true</PublishAot>, runtime provided.al2023, memory 1024 MB
~~~`,
  dia: r`stateDiagram-v2
  [*] --> Init: first request or scale-out
  Init --> Invoke: cold start done
  Invoke --> Frozen: response returned
  Frozen --> Invoke: next request - warm
  Frozen --> Shutdown: idle or scale-in
  Shutdown --> [*]`,
  pts: [r`Init runs once per environment; reuse clients and avoid per-invoke setup.`, r`One event at a time per environment; concurrency = rps x duration.`, r`Native AOT, SnapStart, more memory and provisioned concurrency reduce cold starts.`, r`SnapStart clones init state; refresh uniqueness-sensitive values.`, r`Reserved concurrency caps blast radius; use RDS Proxy for relational access.`],
  ex: r`A card-authorisation enrichment Lambda moved to Native AOT and 1,536 MB; p99 cold start fell from about 1.8 s to about 300 ms and monthly cost dropped because invocations finished faster.`,
  fu: [r`What breaks when you enable Native AOT on an existing function?`, r`How do you size provisioned concurrency?`],
  pit: [r`Creating SDK clients inside the handler.`, r`Ignoring that reserved concurrency also caps the function.`, r`Generating random IDs at init with SnapStart enabled.`] },

{ id: 'q17', level: 'Intermediate', tags: ['api-gateway', 'throttling', 'authorizers'],
  q: r`REST API versus HTTP API in API Gateway: features, limits and costs. How do throttling, authorizers, usage plans and the integration timeout affect a .NET backend?`,
  a: r`| | REST API (v1) | HTTP API (v2) |
|---|---|---|
| Price | higher | roughly 70% cheaper per request |
| Latency | higher | lower |
| Auth | IAM, Cognito, Lambda authorizers, API keys + usage plans | IAM, JWT authorizer (OIDC), Lambda authorizers |
| Extras | request validation, transformation (VTL), caching, WAF, private APIs, canary stages, X-Ray | simpler; native JWT; no API caching or usage plans |
| Timeout | 29 s default; raisable for Regional/private APIs | 30 s maximum |

**Choose HTTP API** for most internal and SPA-facing JSON APIs with OIDC tokens. **Choose REST API** when you need usage plans and API keys for partners, WAF directly on the API, request validation, private APIs (VPC-only) or edge caching.

**Throttling** is a token bucket at several levels: account per Region (10,000 rps steady, 5,000 burst by default), stage and route limits, and per-client limits in usage plans. Throttled calls get **429**; clients must back off with jitter.

**Authorizers**
- **JWT authorizer** (HTTP API) validates issuer, audience, signature and expiry with no code — the default for OIDC.
- **Lambda authorizer** for custom tokens or entitlement lookups; **cache the policy** (TTL up to 1 hour) keyed on the token, or every request pays an extra Lambda call.
- Still authorise **inside the service** for object-level checks (can this user see account 42?). The gateway checks identity, not ownership.

**Integration timeout:** a long synchronous operation (a 40-second report) must become asynchronous: return **202 Accepted** with a status URL, process via SQS/Step Functions, let the client poll or receive a webhook.

**Payload** up to 10 MB; upload larger files directly to S3 with pre-signed URLs.

**With a .NET backend:** Lambda proxy integration via {{Amazon.Lambda.AspNetCoreServer.Hosting}} runs a normal ASP.NET Core app; or VPC Link to an ALB/NLB in front of ECS. Propagate {{X-Request-Id}} / {{traceparent}} and map gateway error responses to your problem-details format.`,
  code: r`~~~csharp
// ASP.NET Core minimal API running on Lambda behind an HTTP API
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddAWSLambdaHosting(LambdaEventSource.HttpApi);   // no-op when run locally on Kestrel
var app = builder.Build();

app.MapPost("/v1/reports", async (ReportRequest req, IAmazonSQS sqs, ClaimsPrincipal user) =>
{
    var id = Guid.NewGuid();
    await sqs.SendMessageAsync(queueUrl, JsonSerializer.Serialize(req with { ReportId = id, Owner = user.FindFirstValue("sub")! }));
    return Results.Accepted($"/v1/reports/{id}", new { id, status = "QUEUED" }); // async instead of a 40 s request
}).RequireAuthorization();

app.Run();
~~~`,
  dia: r`flowchart LR
  C[SPA / partner] -->|JWT| G[API Gateway HTTP API]
  G -->|JWT authorizer: iss, aud, exp| G
  G -->|throttle per route| L[Lambda: ASP.NET Core]
  G -->|VPC Link| N[ALB] --> E[ECS service]
  L -->|long work| Q[(SQS)] --> W[Worker]
  C -.poll status URL.-> G`,
  pts: [r`HTTP API is cheaper and faster; REST API has usage plans, validation, caching, WAF, private APIs.`, r`Throttling is layered token buckets; 429 means back off with jitter.`, r`JWT authorizer for OIDC; cache Lambda authorizer results; still authorise objects in the service.`, r`29-30 s timeout means long work goes async with 202 + status URL.`, r`Large payloads go to S3 via pre-signed URLs.`],
  ex: r`A wealth platform moved partner APIs to a REST API with usage plans (100 rps per partner) and internal SPA APIs to an HTTP API, cutting gateway cost by about 60%.`,
  fu: [r`How do you implement per-tenant rate limits beyond usage plans?`, r`When would you put CloudFront in front of API Gateway?`],
  pit: [r`Relying on the gateway for object-level authorisation.`, r`Synchronous endpoints that run longer than the integration timeout.`, r`Uncached Lambda authorizers doubling latency.`] },

{ id: 'q18', level: 'Intermediate', tags: ['cloudwatch', 'observability', 'opentelemetry'],
  q: r`Instrument a .NET service on AWS end to end: CloudWatch Logs, metrics (including EMF), alarms, and distributed tracing with X-Ray and OpenTelemetry (ADOT). What do you alert on?`,
  a: r`**Logs**: structured JSON to stdout (Serilog/Microsoft.Extensions.Logging JSON console). ECS (awslogs/FireLens), EKS (Fluent Bit) and Lambda ship it to **CloudWatch Logs**. Include {{traceId}}, {{correlationId}}, tenant and operation; never PANs, secrets or full tokens. Set **retention** per log group (default is never expire, which costs money) and export to S3 for long-term audit.

**Metrics**
- AWS publishes service metrics (ALB {{TargetResponseTime}}, {{HTTPCode_Target_5XX_Count}}, SQS {{ApproximateAgeOfOldestMessage}}, RDS CPU/connections, Lambda {{Errors}}/{{Throttles}}/{{ConcurrentExecutions}}).
- Application metrics via **Embedded Metric Format**: a JSON log line that CloudWatch extracts into metrics asynchronously — no {{PutMetricData}} calls in the hot path. Watch **high-cardinality dimensions** (never customer id); each unique dimension combination is a billed metric.
- Or OpenTelemetry metrics to **Amazon Managed Service for Prometheus** + Grafana.

**Tracing**: AWS now steers new instrumentation to **OpenTelemetry**. Use the OpenTelemetry .NET SDK with AWS instrumentation, export via the **ADOT collector** (sidecar or daemonset) or directly to the X-Ray OTLP endpoint. Use W3C {{traceparent}} end to end; propagate through SQS/SNS message attributes so asynchronous hops stay in one trace. **CloudWatch Application Signals** builds service maps and SLOs from this telemetry.

**Alerting: alert on symptoms users feel, not causes**
- SLO burn rate on availability and latency (p99 from ALB or traces), not average CPU.
- Queue **age**, DLQ depth greater than zero, consumer error rate.
- Saturation that precedes failure: DB connections near max, Lambda throttles, NAT port allocation errors, disk.
- Use **composite alarms** to reduce noise and **anomaly detection** for seasonal traffic.
- Every alarm has an owner and a runbook link.

**Audit is separate**: **CloudTrail** records API calls (who changed the security group), organization trail to a locked log-archive account. Application logs are not an audit trail.`,
  code: r`~~~csharp
// OpenTelemetry for an ASP.NET Core service on ECS, exporting OTLP to the ADOT collector sidecar
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService("payments-api").AddAWSEBSDetector().AddAWSECSDetector())
    .WithTracing(t => t
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddAWSInstrumentation()                     // SDK calls: DynamoDB, SQS, S3 ...
        .AddSource("Payments")
        .AddOtlpExporter())                          // http://localhost:4317 -> ADOT -> X-Ray
    .WithMetrics(m => m.AddAspNetCoreInstrumentation().AddRuntimeInstrumentation().AddOtlpExporter());

// EMF line: becomes metric PaymentsCaptured{Region=EU} without calling PutMetricData
logger.LogInformation("{_aws}", JsonSerializer.Serialize(new {
    _aws = new { Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                 CloudWatchMetrics = new[] { new { Namespace = "Payments", Dimensions = new[] { new[] { "Region" } },
                 Metrics = new[] { new { Name = "PaymentsCaptured", Unit = "Count" } } } } },
    Region = "EU", PaymentsCaptured = 1 }));
~~~`,
  dia: r`flowchart LR
  A[.NET task: OTel SDK] -->|OTLP| C[ADOT collector]
  C -->|traces| X[X-Ray / Application Signals]
  C -->|metrics| M[CloudWatch or Managed Prometheus]
  A -->|JSON logs + EMF| L[CloudWatch Logs]
  L -->|extracted metrics| M
  M --> AL[Alarms: burn rate, queue age, DLQ]
  AL --> SNS[SNS -> PagerDuty]
  CT[CloudTrail org trail] --> LA[(Log archive account S3, Object Lock)]`,
  pts: [r`Structured JSON logs with trace ids and retention set; no sensitive data.`, r`EMF for cheap application metrics; avoid high-cardinality dimensions.`, r`OpenTelemetry + ADOT for traces; propagate context through queues.`, r`Alert on SLO burn, queue age, DLQ, saturation; owner and runbook per alarm.`, r`CloudTrail is the audit trail, stored immutably in a separate account.`],
  ex: r`A payments team replaced 140 CPU and memory alarms with 12 SLO burn-rate and queue-age alarms; pages fell by 80% and mean time to detect dropped from 14 to 4 minutes.`,
  fu: [r`How do you keep trace context across an SQS hop?`, r`How do you control CloudWatch Logs cost at 2 TB/day?`],
  pit: [r`Using a customer id as a metric dimension.`, r`Log groups with infinite retention by default.`, r`Alerting on average CPU instead of user-facing symptoms.`] },

{ id: 'q19', level: 'Senior', tags: ['lambda', 'sqs', 'event-source-mapping', 'idempotency'],
  q: r`Design SQS-triggered Lambda processing for payment notifications: batching, partial batch failures, scaling and concurrency limits, idempotency, and protecting a downstream database.`,
  a: r`**How the event source mapping (ESM) works**: Lambda's pollers long-poll the queue, build batches (up to 10 for FIFO; up to 10,000 for Standard with a **batching window** of up to 5 minutes) and invoke the function synchronously. On success the poller deletes the messages; on failure they become visible again after the visibility timeout.

**Partial batch failure**: without it, one bad message fails the whole batch and nine good ones are reprocessed. Enable **{{ReportBatchItemFailures}}** and return the ids of failed messages only.

**Settings that must line up**
- Queue **visibility timeout ≥ 6 × function timeout** (AWS guidance), so in-flight batches do not reappear.
- **Redrive policy** with {{maxReceiveCount}} (for example 5) to a DLQ; alarm on DLQ depth.
- **Maximum concurrency** on the ESM (minimum 2) caps how many environments this queue drives, protecting the database. It is better than reserved concurrency alone, which causes throttles and pushes messages back to the queue.
- Scaling: Standard-queue pollers scale up by roughly 300 concurrent invocations per minute to a maximum of 1,250 per mapping (higher with provisioned mode). FIFO scales up to the number of active **message groups**.

**Idempotency**: SQS Standard delivers at least once; Lambda retries batches. Use **Powertools for AWS Lambda (.NET) Idempotency** (DynamoDB table with conditional writes, keyed on a payload hash or message id) or a unique constraint in the database. The idempotency record stores the result, so a retry returns it without repeating the side effect.

**Protecting downstream**: RDS Proxy for relational targets; ESM maximum concurrency matched to the database's connection budget; a circuit breaker or failure-rate based pause; backpressure is the queue itself — let it grow and alarm on age.

**Ordering**: FIFO + message group id (for example account id) gives per-account order; a failure in a group blocks that group until it succeeds or reaches the DLQ.`,
  code: r`~~~csharp
public class Function
{
    private static readonly AmazonDynamoDBClient Dynamo = new();

    [Idempotent] // AWS.Lambda.Powertools.Idempotency: DynamoDB-backed, keyed on the record's payload hash
    private async Task<string> ProcessAsync(NotificationCommand cmd) =>
        await Notifier.SendAsync(cmd); // returns provider message id, stored with the idempotency record

    public async Task<SQSBatchResponse> Handler(SQSEvent evt, ILambdaContext ctx)
    {
        var failures = new List<SQSBatchResponse.BatchItemFailure>();
        foreach (var record in evt.Records)
        {
            try { await ProcessAsync(JsonSerializer.Deserialize<NotificationCommand>(record.Body)!); }
            catch (Exception ex)
            {
                ctx.Logger.LogError($"{record.MessageId}: {ex.Message}");
                failures.Add(new() { ItemIdentifier = record.MessageId }); // only this one is retried
            }
        }
        return new SQSBatchResponse(failures);
    }
}
// ESM: BatchSize 50, MaximumBatchingWindowInSeconds 2, FunctionResponseTypes [ReportBatchItemFailures],
//      ScalingConfig.MaximumConcurrency 20; queue VisibilityTimeout = 6 x function timeout; redrive maxReceiveCount 5
~~~`,
  dia: r`flowchart LR
  Q[(SQS notifications)] -->|pollers build batches| ESM[Event source mapping - max concurrency 20]
  ESM --> F[Lambda function]
  F -->|conditional put| I[(DynamoDB idempotency table)]
  F -->|send| P[SMS / email provider]
  F -->|batchItemFailures| ESM
  Q -->|maxReceiveCount exceeded| D[(DLQ)] --> A[Alarm + redrive tooling]`,
  pts: [r`Enable ReportBatchItemFailures so one bad message does not replay the batch.`, r`Visibility timeout at least 6x the function timeout; DLQ with maxReceiveCount.`, r`ESM maximum concurrency protects downstream better than throttling.`, r`Idempotency via Powertools or a unique constraint; store the result.`, r`FIFO groups give per-key order but block on a failing message.`],
  ex: r`An insurer's claims-notification Lambda sent duplicate SMS during a provider slowdown; adding Powertools idempotency and ESM maximum concurrency of 10 stopped duplicates and kept the provider under its rate limit.`,
  fu: [r`How do you drain a DLQ safely after a bug fix?`, r`Why can reserved concurrency alone cause messages to land in the DLQ?`],
  pit: [r`Throwing on any failure and replaying whole batches.`, r`Visibility timeout shorter than the function timeout.`, r`No limit on concurrency against a relational database.`] },

{ id: 'q20', level: 'Senior', tags: ['step-functions', 'saga', 'orchestration', 'workflows'],
  q: r`Use Step Functions to orchestrate a payment saga (reserve funds, screen sanctions, capture, notify) with compensation. Standard or Express? How do retries, callbacks with task tokens and idempotency work?`,
  a: r`**Standard vs Express**
| | Standard | Express |
|---|---|---|
| Duration | up to 1 year | up to 5 minutes |
| Semantics | exactly-once execution of workflow steps; full history | at-least-once (async) / at-most-once (sync) |
| Pricing | per state transition | per request + duration and memory |
| Use | long-running, human steps, audit trail | high-volume, short, idempotent event processing |

A payment saga with external screening and human review is **Standard**: durable, auditable step history (retained 90 days in the console; export for longer retention), waits up to a year.

**Building the saga**
- Each step is a **Task** state calling a service: direct SDK integrations (DynamoDB, SQS, EventBridge) avoid Lambda glue.
- **Retry** per error type with {{IntervalSeconds}}, {{BackoffRate}}, {{MaxAttempts}}, {{JitterStrategy: FULL}}; **Catch** routes failures to compensations.
- **Compensation in reverse order**: capture failed → release reservation → notify failure. Compensations must be idempotent and retried until they succeed, because "undo failed" is the worst state.
- **Callback pattern ({{.waitForTaskToken}})**: the workflow sends a token to a sanctions team or an external screening service and pauses; the service calls {{SendTaskSuccess}}/{{SendTaskFailure}} with the token. Add **HeartbeatSeconds** and a timeout so lost callbacks fail visibly.
- **Idempotency**: use the payment id as the **execution name** — Standard rejects a second start with the same name (for 90 days), which stops double starts. Pass an idempotency key to every downstream call so Step Functions retries do not double-charge.

**Limits that bite**: 256 KB payload per state (put documents in S3 and pass the key); execution history limit of 25,000 events (use child workflows or Distributed Map for large fan-outs).

**When not to use it**: a pure in-process sequence of fast calls (latency and cost per transition) or extremely high event rates — use choreography or Express there.`,
  code: r`~~~json
{
  "StartAt": "ReserveFunds",
  "States": {
    "ReserveFunds": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": { "FunctionName": "reserve-funds", "Payload": { "paymentId.$": "$.paymentId", "idempotencyKey.$": "$.paymentId" } },
      "Retry": [{ "ErrorEquals": ["Lambda.ServiceException", "States.Timeout"], "IntervalSeconds": 2, "BackoffRate": 2, "MaxAttempts": 3, "JitterStrategy": "FULL" }],
      "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "NotifyFailure" }], "Next": "SanctionsScreen" },
    "SanctionsScreen": { "Type": "Task", "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
      "Parameters": { "QueueUrl": "https://sqs.eu-west-1.amazonaws.com/111122223333/screening",
                      "MessageBody": { "paymentId.$": "$.paymentId", "token.$": "$$.Task.Token" } },
      "TimeoutSeconds": 3600, "HeartbeatSeconds": 600,
      "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "ReleaseFunds" }], "Next": "Capture" },
    "Capture": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": { "FunctionName": "capture", "Payload.$": "$" },
      "Catch": [{ "ErrorEquals": ["States.ALL"], "Next": "ReleaseFunds" }], "Next": "NotifySuccess" },
    "ReleaseFunds": { "Type": "Task", "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": { "FunctionName": "release-funds", "Payload.$": "$" },
      "Retry": [{ "ErrorEquals": ["States.ALL"], "MaxAttempts": 10, "BackoffRate": 2 }], "Next": "NotifyFailure" },
    "NotifySuccess": { "Type": "Task", "Resource": "arn:aws:states:::events:putEvents", "Parameters": { "Entries": [{ "Source": "payments", "DetailType": "PaymentCompleted", "Detail.$": "$" }] }, "End": true },
    "NotifyFailure": { "Type": "Task", "Resource": "arn:aws:states:::events:putEvents", "Parameters": { "Entries": [{ "Source": "payments", "DetailType": "PaymentFailed", "Detail.$": "$" }] }, "End": true }
  }
}
~~~`,
  dia: r`flowchart TD
  S[Start - execution name = paymentId] --> R[ReserveFunds]
  R -->|ok| SC[SanctionsScreen - waitForTaskToken]
  SC -->|cleared| C[Capture]
  C -->|ok| NS[Emit PaymentCompleted]
  SC -->|hit or timeout| RF[ReleaseFunds - retried until success]
  C -->|failed| RF
  RF --> NF[Emit PaymentFailed]
  R -->|failed| NF`,
  pts: [r`Standard for long, auditable sagas; Express for short high-volume idempotent work.`, r`Retry per error type with backoff and jitter; Catch routes to compensations in reverse order.`, r`Task tokens pause for external or human steps; add heartbeats and timeouts.`, r`Execution name = business id prevents double starts; pass idempotency keys downstream.`, r`Watch the 256 KB payload and 25,000-event history limits.`],
  ex: r`A cross-border payments team moved a hand-written state machine in SQL tables to Step Functions Standard; stuck payments became visible in the console and the 3 a.m. "where is payment X" calls stopped.`,
  fu: [r`Orchestration or choreography for this saga, and why?`, r`What happens to in-flight executions when you deploy a new state machine version?`],
  pit: [r`Using Express for a workflow that waits for human approval.`, r`Compensations that can fail silently.`, r`Passing large documents between states instead of S3 keys.`] },

{ id: 'q21', level: 'Senior', tags: ['ecs', 'fargate', 'deployments', 'graceful-shutdown'],
  q: r`Run a .NET API on ECS Fargate in production: task definitions, services, rolling versus blue/green deployments, the deployment circuit breaker, health checks, and graceful shutdown with zero dropped requests.`,
  a: r`**Building blocks**
- **Task definition**: image (by digest), CPU/memory, port mappings, **task role** (app permissions) and **execution role** (pull image, read secrets for injection), secrets from Secrets Manager/SSM, log configuration, health check, {{stopTimeout}}.
- **Service**: desired count, spread across AZs, attached to an ALB **target group**, auto scaling policies, deployment configuration.
- **Fargate**: no hosts to patch; each task gets its own ENI in your subnet (awsvpc mode), so **security groups apply per task**. Consider ARM64 (Graviton) for better price-performance.

**Deployments**
- **Rolling** with {{minimumHealthyPercent=100}}, {{maximumPercent=200}}: start new tasks, wait for ALB health, drain old ones.
- **Deployment circuit breaker with rollback**: if new tasks keep failing to reach steady state, ECS rolls back automatically. Always enable it; add **CloudWatch alarm-based rollback** for errors that health checks miss (5xx rate, latency).
- **Blue/green**: ECS now has built-in blue/green deployments (2025), and CodeDeploy remains an option. Traffic shifts all at once, linearly or canary to a green target group, with bake time, test listeners and instant rollback.

**Health checks** — three different things:
- **ALB target health** ({{/health/ready}}): can this task take traffic? Check critical dependencies lightly.
- **Container health check** in the task definition: is the process alive? Keep it to liveness ({{/health/live}}); a database blip must not kill every task.
- **Health check grace period** for slow-starting .NET apps.

**Graceful shutdown (zero dropped requests)**
1. ECS deregisters the task from the target group; the ALB stops sending **new** requests and waits for **deregistration delay** (default 300 s — lower it to 30-60 s for fast APIs).
2. ECS sends **SIGTERM**; .NET's host starts shutdown: {{IHostApplicationLifetime.ApplicationStopping}} fires, Kestrel stops accepting and finishes in-flight requests, background services get cancellation.
3. After {{stopTimeout}} (default 30 s, max 120 s on Fargate) ECS sends **SIGKILL**.
Set {{HostOptions.ShutdownTimeout}} below {{stopTimeout}}, and make queue consumers stop pulling and finish or release the current message.`,
  code: r`~~~csharp
// Program.cs: health endpoints and shutdown budget aligned with the task definition
builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(25)); // < stopTimeout 30s
builder.Services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])
    .AddNpgSql(connString, name: "db", tags: ["ready"], timeout: TimeSpan.FromSeconds(2));

var app = builder.Build();
app.MapHealthChecks("/health/live",  new() { Predicate = c => c.Tags.Contains("live") });
app.MapHealthChecks("/health/ready", new() { Predicate = c => c.Tags.Contains("ready") });
~~~
~~~json
// Service deployment configuration (CloudFormation/CDK equivalent)
{ "deploymentConfiguration": {
    "minimumHealthyPercent": 100, "maximumPercent": 200,
    "deploymentCircuitBreaker": { "enable": true, "rollback": true },
    "alarms": { "alarmNames": ["payments-api-5xx-rate"], "enable": true, "rollback": true } },
  "healthCheckGracePeriodSeconds": 60 }
// Target group: deregistration_delay.timeout_seconds = 45; container stopTimeout = 30
~~~`,
  dia: r`sequenceDiagram
  participant ECS
  participant ALB
  participant Task as Old task (.NET)
  ECS->>ALB: deregister target
  ALB-->>Task: no new requests, in-flight continue
  Note over ALB: deregistration delay 45s
  ECS->>Task: SIGTERM
  Task->>Task: ApplicationStopping, Kestrel drains, consumers stop
  Task-->>ECS: exit 0 within ShutdownTimeout
  Note over ECS,Task: SIGKILL only if stopTimeout elapses`,
  pts: [r`Task role for the app, execution role for ECS agent duties; images by digest.`, r`Enable the deployment circuit breaker and alarm-based rollback.`, r`Blue/green (ECS built-in or CodeDeploy) for canary and instant rollback.`, r`Readiness for the ALB, liveness for the container check; separate them.`, r`Align deregistration delay, stopTimeout and HostOptions.ShutdownTimeout.`],
  ex: r`A trading-portal API dropped about 40 requests per deploy until the team handled SIGTERM, set ShutdownTimeout to 25 s and lowered the deregistration delay to 45 s; deploys became invisible to users.`,
  fu: [r`Why can a database-dependent liveness check cause a full outage?`, r`How do you deploy a schema change alongside a blue/green release?`],
  pit: [r`Container health checks that call the database.`, r`Default 300 s deregistration delay slowing every deploy.`, r`Tagging images as latest and losing rollback determinism.`] },

{ id: 'q22', level: 'Senior', tags: ['eks', 'kubernetes', 'vpc-cni', 'karpenter'],
  q: r`Operate .NET workloads on EKS: what AWS owns versus what you own, VPC CNI IP exhaustion, node provisioning with Karpenter or Auto Mode, load balancing, pod identity and cluster upgrades.`,
  a: r`**Responsibility split**: AWS runs the control plane (API server, etcd) across three AZs. You own nodes (unless Fargate or **EKS Auto Mode**), add-ons, networking choices, upgrades, security and workloads.

**Networking: VPC CNI** gives every pod a **real VPC IP**. Fast and simple (security groups and flow logs see pods), but **pods consume subnet IPs** — a /24 subnet (251 usable) exhausts quickly with 30 pods per node.
- Plan large subnets or add a **secondary CIDR** (for example 100.64.0.0/16) for pods.
- Enable **prefix delegation** (a /28 per ENI slot) to raise pods per node and cut EC2 API calls.
- **Security groups for pods** when a pod needs its own SG to reach RDS.

**Nodes**
- **Karpenter** provisions right-sized nodes in seconds from pending pods, mixes instance types, uses Spot with interruption handling, and consolidates under-used nodes.
- **EKS Auto Mode** (since late 2024) has AWS manage compute (Karpenter-based), core add-ons and node patching — less to run, less control.
- Spread with **topology spread constraints** across zones; set **PodDisruptionBudgets** so consolidation and upgrades do not take all replicas.

**Ingress**: the **AWS Load Balancer Controller** creates ALBs from Ingress (or Gateway API) and NLBs from Services, using **IP target mode** so the ALB targets pods directly.

**Identity**: **EKS Pod Identity** (or IRSA) gives a service account an IAM role; never use the node role for apps (every pod on the node would inherit it). Block pod access to instance metadata (IMDSv2 hop limit 1).

**Upgrades**: Kubernetes minor versions get about 14 months of standard support, then extended support at extra cost. Upgrade one minor version at a time: check deprecated APIs, upgrade the control plane, add-ons (CNI, CoreDNS, kube-proxy), then node groups (Karpenter drift replaces nodes). **Blue/green clusters** for high-risk changes.

**.NET specifics**: set container-aware limits ({{DOTNET_GCHeapHardLimitPercent}} or rely on cgroup detection), choose Server GC with enough CPU or Workstation GC for small pods, and do not set CPU limits so low that the thread pool starves.`,
  code: r`~~~yaml
# Karpenter NodePool: on-demand + spot, Graviton allowed, consolidation on
apiVersion: karpenter.sh/v1
kind: NodePool
metadata: { name: general }
spec:
  template:
    spec:
      requirements:
        - { key: karpenter.sh/capacity-type, operator: In, values: [spot, on-demand] }
        - { key: kubernetes.io/arch, operator: In, values: [arm64, amd64] }
      nodeClassRef: { group: karpenter.k8s.aws, kind: EC2NodeClass, name: default }
  disruption: { consolidationPolicy: WhenEmptyOrUnderutilized, consolidateAfter: 2m }
  limits: { cpu: "400" }
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: payments-api }
spec: { minAvailable: 2, selector: { matchLabels: { app: payments-api } } }
# Pod Identity: aws eks create-pod-identity-association --cluster prod --namespace payments \
#   --service-account payments-api --role-arn arn:aws:iam::111122223333:role/payments-api
~~~`,
  dia: r`flowchart TB
  subgraph AWS[AWS-managed]
    CP[EKS control plane - 3 AZs]
  end
  subgraph VPC[Your VPC]
    ALB[ALB via LB Controller - IP targets]
    subgraph N1[Node AZ a - Karpenter]
      P1[payments-api pod - VPC IP]
    end
    subgraph N2[Node AZ b - Karpenter]
      P2[payments-api pod - VPC IP]
    end
  end
  CP --> N1
  CP --> N2
  ALB --> P1
  ALB --> P2
  P1 -->|Pod Identity role| DDB[(DynamoDB)]`,
  pts: [r`AWS owns the control plane; you own nodes, add-ons, upgrades and security unless Auto Mode.`, r`VPC CNI pods use subnet IPs: plan CIDRs, secondary ranges, prefix delegation.`, r`Karpenter or Auto Mode for fast, right-sized, Spot-aware nodes; PDBs and spread constraints.`, r`LB Controller with IP targets; Pod Identity per service account, never the node role.`, r`Upgrade one minor at a time; plan for the ~14-month support window.`],
  ex: r`A bank's EKS cluster stopped scheduling pods at month-end because a /24 pod subnet ran out of IPs; a 100.64.0.0/16 secondary CIDR with prefix delegation removed the ceiling.`,
  fu: [r`EKS or ECS for a 15-service .NET estate with a small platform team?`, r`How do you roll out a CNI add-on upgrade safely?`],
  pit: [r`Granting AWS permissions through the node instance role.`, r`Small subnets with VPC CNI.`, r`Falling into extended support by skipping upgrades.`] },

{ id: 'q23', level: 'Senior', tags: ['transit-gateway', 'privatelink', 'vpc-peering', 'networking'],
  q: r`Connect 60 VPCs across accounts plus on-premises: VPC peering, Transit Gateway, PrivateLink or VPC Lattice? Include centralised egress and inspection.`,
  a: r`**Options**
- **VPC peering**: one-to-one, non-transitive, no bandwidth bottleneck, no per-hour charge. 60 VPCs in full mesh = 60 × 59 / 2 = **1,770 peerings** and route entries. Fine for a handful of VPCs; unmanageable at scale. CIDRs must not overlap.
- **Transit Gateway (TGW)**: a regional hub router. Each VPC attaches once; **route tables** segment traffic (prod cannot reach dev; shared services reachable by all). Connects VPN and Direct Connect. Charged per attachment-hour and **per GB processed**. Inter-Region TGW peering links Regions.
- **PrivateLink**: exposes **one service** (behind an NLB) as an interface endpoint in consumer VPCs. One-directional, **overlapping CIDRs are fine**, no route-table changes, consumers cannot reach anything else. Ideal for platform services and SaaS.
- **VPC Lattice**: application-layer service networking (HTTP/gRPC/TCP) across VPCs and accounts with IAM auth policies; no need to manage routing or CIDR overlap. Good for service-to-service at scale when you want policy at layer 7.

**A typical enterprise hub**
- TGW per Region, shared from a **network account** via RAM.
- Route tables: {{prod}}, {{nonprod}}, {{shared}}, {{inspection}}.
- **Centralised egress VPC**: NAT Gateways plus **AWS Network Firewall** (domain allow lists for outbound calls to PSPs and card schemes), so 60 VPCs do not each pay for NAT and do not each need egress rules.
- **Inspection VPC** for east-west traffic between security zones (TGW appliance mode keeps flows symmetric).
- **Direct Connect gateway** attached to TGW for on-premises; Site-to-Site VPN as backup.
- **IPAM** to allocate non-overlapping CIDRs centrally.

**Trade-offs to say aloud**: TGW centralises routing but adds data-processing cost and a shared dependency; PrivateLink is the cleanest least-privilege option for exposing services; Lattice moves policy to the application layer. Many estates combine them: TGW for broad connectivity and on-premises, PrivateLink or Lattice for service exposure.`,
  code: r`~~~hcl
# Terraform: TGW with segmented route tables; prod VPC attaches and propagates only to prod + shared
resource "aws_ec2_transit_gateway" "hub" {
  description                     = "eu-west-1 hub"
  default_route_table_association = "disable"
  default_route_table_propagation = "disable"
}
resource "aws_ec2_transit_gateway_route_table" "prod"   { transit_gateway_id = aws_ec2_transit_gateway.hub.id }
resource "aws_ec2_transit_gateway_route_table" "shared" { transit_gateway_id = aws_ec2_transit_gateway.hub.id }

resource "aws_ec2_transit_gateway_vpc_attachment" "payments_prod" {
  transit_gateway_id = aws_ec2_transit_gateway.hub.id
  vpc_id             = var.payments_prod_vpc_id
  subnet_ids         = var.payments_prod_tgw_subnets   # one small /28 per AZ
}
resource "aws_ec2_transit_gateway_route_table_association" "payments" {
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_vpc_attachment.payments_prod.id
  transit_gateway_route_table_id = aws_ec2_transit_gateway_route_table.prod.id
}
# default route in the prod table -> egress/inspection VPC attachment (Network Firewall + NAT)
resource "aws_ec2_transit_gateway_route" "prod_default" {
  destination_cidr_block         = "0.0.0.0/0"
  transit_gateway_route_table_id = aws_ec2_transit_gateway_route_table.prod.id
  transit_gateway_attachment_id  = var.egress_vpc_attachment_id
}
~~~`,
  dia: r`flowchart TB
  DC[On-premises core banking] -->|Direct Connect + VPN backup| TGW((Transit Gateway))
  P1[Payments prod VPC] --- TGW
  P2[Cards prod VPC] --- TGW
  D1[Dev VPCs] --- TGW
  S[Shared services VPC] --- TGW
  TGW --- E[Egress + inspection VPC: Network Firewall, NAT]
  E --> I[Internet: PSPs, card schemes]
  S -->|PrivateLink endpoint service| P1
  S -->|PrivateLink endpoint service| P2`,
  pts: [r`Peering is non-transitive and does not scale: n(n-1)/2 links.`, r`Transit Gateway is the hub with segmented route tables; pay per GB processed.`, r`PrivateLink exposes one service, tolerates overlapping CIDRs, least privilege.`, r`VPC Lattice puts service-to-service policy at layer 7.`, r`Centralise egress and inspection with Network Firewall; manage CIDRs with IPAM.`],
  ex: r`An asset manager replaced 300 peering connections with a Transit Gateway and centralised egress; NAT Gateway count fell from 96 to 6 and outbound traffic to the internet became allow-listed by domain.`,
  fu: [r`How do you handle overlapping CIDRs after an acquisition?`, r`What does TGW appliance mode solve?`],
  pit: [r`Assuming peering is transitive.`, r`One flat TGW route table connecting prod and dev.`, r`Ignoring TGW per-GB data-processing cost for chatty traffic.`] },

{ id: 'q24', level: 'Senior', tags: ['vpc-endpoints', 'nat', 'cost', 'data-perimeter'],
  q: r`Gateway versus interface VPC endpoints: how do they work, why do they matter for cost and security, and how do endpoint policies help build a data perimeter?`,
  a: r`Without endpoints, a task in a private subnet reaches S3, SQS or Secrets Manager **through the NAT Gateway** to public AWS endpoints. That works but costs money per GB and makes egress control harder.

**Gateway endpoints** (only **S3 and DynamoDB**)
- A route-table entry that sends traffic for the service's prefix list to the endpoint.
- **Free**; no ENIs; same-Region only; not reachable from on-premises or peered VPCs.
- Add them to every VPC by default.

**Interface endpoints** (PrivateLink, about every other service: SQS, SNS, KMS, Secrets Manager, ECR, STS, CloudWatch Logs, EventBridge...)
- An **ENI with a private IP in each chosen subnet**; with **private DNS** enabled the normal SDK hostname resolves to it, so no code change.
- Charged per endpoint per AZ per hour plus per GB — cheaper than NAT for heavy traffic, but 20 endpoints × 3 AZs in 50 VPCs adds up. Large estates **centralise** interface endpoints in a shared VPC and share them via Route 53 private hosted zones over TGW.
- Secure them with a security group (allow 443 from app subnets).

**Why it matters**
- **Cost**: NAT data processing is about 4.5 cents per GB in us-east-1. An ECS service pulling 5 TB/month of images from ECR and data from S3 through NAT pays about 5,000 × 0.045 = **$225/month** in processing alone, avoided by an S3 gateway endpoint (ECR layers are stored in S3) and ECR interface endpoints.
- **Security**: traffic stays on the AWS network, and you can remove internet egress from data subnets entirely.

**Data perimeter with endpoint policies**
- **Endpoint policy**: allow access only to resources in your organization ({{aws:ResourceOrgID}}), so stolen credentials inside the VPC cannot copy data to an attacker's bucket.
- **Bucket/resource policy**: deny access unless it comes from your endpoints ({{aws:SourceVpce}}) or your network ({{aws:SourceVpc}}), with exceptions for AWS services acting on your behalf.
- **SCP/RCP**: deny actions from principals outside the org ({{aws:PrincipalOrgID}}).
Together: **trusted identities, accessing trusted resources, from expected networks.**`,
  code: r`~~~json
// S3 gateway endpoint policy: only buckets owned by our organization
{ "Statement": [{
    "Effect": "Allow", "Principal": "*", "Action": "s3:*", "Resource": "*",
    "Condition": { "StringEquals": { "aws:ResourceOrgID": "o-abc123example" } } }] }

// Bucket policy on the statements bucket: deny unless via our VPC endpoint
{ "Statement": [{
    "Sid": "DenyOutsideVpce", "Effect": "Deny", "Principal": "*", "Action": "s3:*",
    "Resource": ["arn:aws:s3:::bank-statements-prod", "arn:aws:s3:::bank-statements-prod/*"],
    "Condition": {
      "StringNotEquals": { "aws:SourceVpce": "vpce-0a1b2c3d4e5f67890" },
      "Bool": { "aws:PrincipalIsAWSService": "false" } } }] }
~~~`,
  dia: r`flowchart LR
  subgraph VPC[Private subnets]
    T[ECS task]
  end
  T -->|route table prefix list| GE[S3 gateway endpoint - free]
  T -->|private DNS -> ENI| IE[Interface endpoints: SQS, KMS, Secrets, ECR]
  T -.only for true internet.-> NAT[NAT Gateway] --> NET[PSP APIs]
  GE --> S3[(S3 - bucket policy requires vpce)]
  IE --> SVC[AWS service APIs]`,
  pts: [r`Gateway endpoints: S3 and DynamoDB, route-based, free; add everywhere.`, r`Interface endpoints: ENIs with private DNS, billed per AZ-hour and per GB.`, r`Endpoints cut NAT processing cost and allow removing internet egress.`, r`Endpoint policies + resource policies + SCP/RCPs form a data perimeter.`, r`Centralise interface endpoints in large estates.`],
  ex: r`A payments platform found 38% of its network bill was NAT processing of S3 and ECR traffic; gateway and ECR endpoints cut the bill by about $14,000 a month.`,
  fu: [r`Why can't on-premises clients use a gateway endpoint?`, r`What breaks when you add aws:SourceVpce deny to a bucket used by CloudFront?`],
  pit: [r`Routing S3 traffic through NAT.`, r`Endpoints with no policy, leaving exfiltration to other accounts open.`, r`Deny statements that block AWS services acting on your behalf.`] },

{ id: 'q25', level: 'Senior', tags: ['kinesis', 'msk', 'streaming', 'capacity'],
  q: r`Kinesis Data Streams, Amazon MSK or SQS for a market-data and transaction event stream? Size a Kinesis stream for 40,000 events/s of 1 KB, and explain ordering, consumers and replay.`,
  a: r`**What each one is good at**
| | SQS | Kinesis Data Streams | Amazon MSK (Kafka) |
|---|---|---|---|
| Model | queue, message deleted on ack | ordered log per shard, retention 24 h to 365 days | ordered log per partition, retention configurable or tiered |
| Replay | no | yes, by sequence number or timestamp | yes, by offset or timestamp |
| Ordering | FIFO per group | per shard (partition key) | per partition (key) |
| Ops | none | low (on-demand or provisioned shards) | broker sizing, upgrades (MSK Serverless reduces this) |
| Ecosystem | AWS | AWS (Lambda, Firehose, Flink) | Kafka Connect, Streams, Schema Registry, multi-cloud |

**Choose** SQS for work distribution; **Kinesis** for AWS-native streams with modest ops; **MSK** when you need the Kafka ecosystem, existing Kafka skills, very high fan-out or portability.

**Kinesis sizing (provisioned mode)**: a shard accepts **1 MB/s or 1,000 records/s** in and serves **2 MB/s** out (shared across standard consumers).
- Records: 40,000/s ÷ 1,000 = **40 shards**. Bytes: 40,000 × 1 KB ≈ 40 MB/s ÷ 1 MB/s = **40 shards**.
- Add headroom for hot keys and peaks (market open spikes 3-5x): plan about **120-160 shards** or use **on-demand mode**, which scales automatically (it adapts to twice the previous peak, so a sudden first-time spike can still throttle).
- Read side: five consumers × 40 MB/s = 200 MB/s, beyond 2 MB/s per shard shared → use **Enhanced Fan-Out** (dedicated 2 MB/s per consumer per shard, push via HTTP/2).

**Ordering and hot partitions**: the **partition key** decides the shard. Key market data by instrument and transactions by account. A single very hot instrument still lands on one shard (1 MB/s cap) — split it with a suffix and re-order downstream if needed.

**Consumers**: KCL (checkpoints in DynamoDB, lease per shard), Lambda ESM (batch, bisect-on-error, on-failure destination), Managed Service for Apache Flink for windowed analytics, Firehose to S3 for the data lake.

**Failure semantics**: at-least-once. Producers retry and can duplicate; consumers dedupe on an event id. One failing record blocks its shard for a Lambda consumer unless you use bisect, maximum retry attempts and an on-failure destination.`,
  code: r`~~~csharp
// Producer: partition by account so each account's events stay ordered
var resp = await kinesis.PutRecordsAsync(new PutRecordsRequest
{
    StreamName = "transactions",
    Records = batch.Select(e => new PutRecordsRequestEntry
    {
        PartitionKey = e.AccountId,                                   // ordering scope
        Data = new MemoryStream(JsonSerializer.SerializeToUtf8Bytes(e))
    }).ToList()
}, ct);

if (resp.FailedRecordCount > 0)                                      // partial failure is normal under throttling
{
    var retry = resp.Records.Select((r, i) => (r, i)).Where(x => x.r.ErrorCode is not null)
                    .Select(x => batch[x.i]).ToList();
    await RetryWithBackoffAsync(retry, ct);                           // ProvisionedThroughputExceededException
}
~~~`,
  dia: r`flowchart LR
  P1[Card switch] -->|key = accountId| KDS[(Kinesis stream - shards)]
  P2[Market data gateway] -->|key = instrument| KDS
  KDS -->|Enhanced Fan-Out| F[Flink: fraud features]
  KDS -->|Lambda ESM| L[Ledger projector]
  KDS --> FH[Firehose] --> S3[(S3 data lake - Parquet)]
  KDS -->|KCL, checkpoints| C[Risk engine on ECS]`,
  pts: [r`SQS for work queues; Kinesis for AWS-native replayable streams; MSK for the Kafka ecosystem.`, r`Shard = 1 MB/s or 1,000 rec/s in, 2 MB/s out; size on both and add peak headroom.`, r`Enhanced Fan-Out for many consumers.`, r`Partition key defines order and hot shards.`, r`At-least-once: handle partial PutRecords failures and dedupe downstream.`],
  ex: r`An exchange-data team keyed all quotes by venue; one venue saturated its shard at market open. Re-keying by instrument spread load across 120 shards and removed throttling.`,
  fu: [r`How does on-demand mode behave on a first-ever spike?`, r`How would you migrate from Kinesis to MSK without losing order?`],
  pit: [r`Sizing shards only on records/s, not bytes.`, r`Ignoring FailedRecordCount on PutRecords.`, r`A low-cardinality partition key.`] },

{ id: 'q26', level: 'Senior', tags: ['dynamodb', 'idempotency', 'streams', 'global-tables'],
  q: r`Use DynamoDB as the AWS-native store for a payments idempotency and transaction service: key design, conditional writes, transactions, Streams to downstream, global tables, and what DynamoDB is the wrong choice for.`,
  a: r`**Key design from access patterns**: get payment by id; list payments for an account by date; look up by idempotency key.
- Table {{payments}}: PK {{ACCT#<accountId>}}, SK {{PAY#<createdAt>#<paymentId>}} → account history by range query.
- Item {{IDEM#<merchantId>#<key>}} → idempotency record.
- GSI on {{paymentId}} for direct lookups.

**Idempotency with conditional writes**: {{PutItem}} with {{attribute_not_exists(PK)}}. The first request wins; a retry gets {{ConditionalCheckFailedException}} and returns the stored response. Store a **request hash** too, so a reused key with a different body is rejected (HTTP 422), not silently replayed. Use **TTL** to expire idempotency records after the retry window (for example 24-72 hours); TTL deletion is asynchronous, so check expiry in code as well.

**Transactions**: {{TransactWriteItems}} for up to 100 items atomically, all-or-nothing, across tables in one Region — for example write the payment item, the idempotency item and an outbox item together. They cost twice the capacity units and can be cancelled by conflicts ({{TransactionCanceledException}}); keep them small.

**Optimistic concurrency**: a {{version}} attribute with a condition {{version = :expected}} prevents lost updates.

**Streams**: every change appears in **DynamoDB Streams** (24 hours, ordered per item) or Kinesis. A Lambda reads them to publish events — the item itself acts as a built-in outbox, no dual write.

**Global tables**: multi-Region, multi-active replication, typically sub-second, **last writer wins** on conflicting writes. Safe for data written in one "home" Region per key (route each account to a home Region). For money movement where two Regions could update the same balance concurrently, last-writer-wins is unacceptable — use single-Region writes per key or the newer multi-Region strong consistency option, accepting its latency.

**Capacity**: on-demand for spiky or new workloads; provisioned + auto scaling for steady load. A partition handles about 3,000 RCU and 1,000 WCU; avoid hot keys. Items max 400 KB.

**Wrong choice when**: ad hoc queries and reporting (export to S3 + Athena instead), many-to-many relational joins, or a team without access-pattern discipline. A double-entry ledger with complex reporting is often better in Aurora PostgreSQL.`,
  code: r`~~~csharp
// Idempotent create: payment + idempotency record + outbox event in one transaction
try
{
    await dynamo.TransactWriteItemsAsync(new TransactWriteItemsRequest
    {
        TransactItems =
        [
            new() { Put = new Put { TableName = "payments", Item = idemItem,          // IDEM#merchant#key, requestHash, response
                     ConditionExpression = "attribute_not_exists(PK)" } },
            new() { Put = new Put { TableName = "payments", Item = paymentItem,
                     ConditionExpression = "attribute_not_exists(PK)" } },
            new() { Put = new Put { TableName = "outbox", Item = eventItem } }
        ]
    }, ct);
    return Results.Created($"/v1/payments/{paymentId}", response);
}
catch (TransactionCanceledException ex) when (ex.CancellationReasons[0].Code == "ConditionalCheckFailed")
{
    var existing = await LoadIdempotencyRecordAsync(merchantId, key, ct);
    return existing.RequestHash == requestHash
        ? Results.Ok(existing.Response)                                       // safe replay
        : Results.UnprocessableEntity("Idempotency-Key reused with a different request");
}
~~~`,
  dia: r`flowchart LR
  API[Payments API] -->|TransactWriteItems| T[(DynamoDB: payments + idempotency)]
  API --> OB[(outbox)]
  T -->|Streams| L[Lambda publisher]
  L --> EB{{EventBridge}}
  T <-->|global table replication, LWW| T2[(Replica - eu-central-1)]`,
  pts: [r`Design keys from access patterns: account history by range, GSI for id lookups.`, r`attribute_not_exists conditional writes implement idempotency; store a request hash.`, r`TransactWriteItems for up to 100 items atomically; double capacity cost.`, r`Streams act as a built-in outbox.`, r`Global tables are last-writer-wins; use home Regions for money.`],
  ex: r`A merchant-acquiring API stored idempotency records in DynamoDB with a 48-hour TTL; during a PSP timeout storm 120,000 client retries returned stored responses and none produced a second charge.`,
  fu: [r`How do you avoid hot partitions for a merchant processing 30% of volume?`, r`How do you report across accounts from DynamoDB?`],
  pit: [r`Read-then-write idempotency checks instead of conditional writes.`, r`Multi-active writes on balances with last-writer-wins.`, r`Relying on TTL for exact expiry.`] },

{ id: 'q27', level: 'Senior', tags: ['organizations', 'control-tower', 'scp', 'multi-account'],
  q: r`Design a multi-account AWS landing zone for a regulated firm: OU structure, Control Tower, SCPs and RCPs, IAM Identity Center, and account vending. Why accounts rather than VPCs as the isolation boundary?`,
  a: r`**Why accounts**: an AWS account is the strongest isolation boundary — separate IAM, quotas, billing and blast radius. A compromised dev role cannot touch prod resources in another account without an explicit trust. VPCs isolate networks, not permissions.

**Typical OU structure**
- **Security OU**: *Log Archive* (organization CloudTrail, Config, VPC flow logs — immutable, Object Lock) and *Audit/Security Tooling* (GuardDuty, Security Hub delegated admin).
- **Infrastructure OU**: network (Transit Gateway, DNS, egress), shared services (CI/CD, ECR, directory).
- **Workloads OU** split into *Prod* and *Non-prod*, one account per workload per environment ({{payments-prod}}, {{payments-dev}}).
- **Sandbox OU** with budgets and auto-expiry; **Suspended OU** for closing accounts; **Policy Staging OU** to test guardrails.

**Control Tower** sets up the landing zone, applies preventive (SCP), detective (Config) and proactive (CloudFormation hooks) **controls**, and provides **Account Factory** (or Account Factory for Terraform) to vend baseline accounts.

**Guardrails**
- **SCPs** cap what principals in member accounts can do (they grant nothing): deny leaving the org, deny disabling CloudTrail/GuardDuty/Config, deny unapproved Regions (data residency), deny creating IAM users with access keys, require IMDSv2 and encryption.
- **RCPs** (resource control policies, since late 2024) cap what can be done **to resources** — for example deny access to S3 and KMS from principals outside the organization, a data-perimeter control that applies even to misconfigured bucket policies.
- **Declarative policies** enforce service configuration (for example block public AMI sharing).

**Human access**: **IAM Identity Center** federated to the corporate IdP (Entra ID/Okta), permission sets per role, short-lived credentials, MFA; break-glass users locked in a safe with alerting. No IAM users for humans.

**Account vending as a product**: a request (Git PR or Service Catalog) produces an account with baseline VPC, IAM roles, logging, budgets and tags in under an hour.

**Management account**: billing and organizations only — no workloads; SCPs do not apply to it.`,
  code: r`~~~json
// SCP on the Workloads OU: Region lock for data residency + protect security services
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "DenyOutsideEURegions", "Effect": "Deny", "NotAction": ["iam:*", "sts:*", "organizations:*", "support:*", "cloudfront:*", "route53:*"],
      "Resource": "*", "Condition": { "StringNotEquals": { "aws:RequestedRegion": ["eu-west-1", "eu-central-1"] } } },
    { "Sid": "ProtectSecurityServices", "Effect": "Deny",
      "Action": ["cloudtrail:StopLogging", "cloudtrail:DeleteTrail", "guardduty:DeleteDetector", "config:StopConfigurationRecorder"],
      "Resource": "*",
      "Condition": { "ArnNotLike": { "aws:PrincipalArn": "arn:aws:iam::*:role/OrgSecurityAdmin" } } },
    { "Sid": "NoIamUserKeys", "Effect": "Deny", "Action": ["iam:CreateUser", "iam:CreateAccessKey"], "Resource": "*" }
  ]
}
~~~`,
  dia: r`flowchart TB
  M[Management account - billing, Organizations only]
  M --> SEC[Security OU]
  M --> INF[Infrastructure OU]
  M --> WL[Workloads OU]
  M --> SB[Sandbox OU]
  SEC --> LA[Log Archive - Object Lock]
  SEC --> AU[Audit: GuardDuty, Security Hub admin]
  INF --> NET[Network: TGW, egress, DNS]
  INF --> SS[Shared services: CI/CD, ECR]
  WL --> PR[Prod OU: payments-prod, cards-prod]
  WL --> NP[Non-prod OU: payments-dev, payments-uat]
  IDC[IAM Identity Center + corporate IdP] -.permission sets.-> PR
  IDC -.permission sets.-> NP`,
  pts: [r`Accounts are the isolation boundary for permissions, quotas, billing and blast radius.`, r`Security, Infrastructure, Workloads (prod/non-prod) and Sandbox OUs.`, r`SCPs cap principals, RCPs cap resources; neither grants access.`, r`Identity Center with the corporate IdP; no IAM users for humans.`, r`Account vending with baselines; no workloads in the management account.`],
  ex: r`A bank's Region-deny SCP gave auditors a single artefact proving EU data residency for 140 accounts, replacing per-account evidence spreadsheets.`,
  fu: [r`Why do Region-deny SCPs need exemptions for global services?`, r`How do you test a new SCP without breaking production?`],
  pit: [r`Running workloads in the management account.`, r`Thinking SCPs grant permissions.`, r`One shared prod account for all teams.`] },

{ id: 'q28', level: 'Senior', tags: ['guardduty', 'security-hub', 'config', 'detection-response'],
  q: r`Build threat detection and automated response on AWS: CloudTrail, GuardDuty, Security Hub, Config, Inspector, Macie. Walk through responding to a GuardDuty finding that an EC2 role's credentials are used from an external IP.`,
  a: r`**What each service does**
| Service | Role |
|---|---|
| **CloudTrail** | API audit log; organization trail; data events for S3/Lambda where needed |
| **GuardDuty** | threat detection from CloudTrail, VPC flow logs, DNS, EKS audit logs, runtime and S3 events; ML and threat intel |
| **Security Hub** | aggregates findings (GuardDuty, Inspector, Macie, Config, partners) and runs standards (CIS, AWS FSBP, PCI DSS) |
| **Config** | resource inventory, configuration history and rules (is every bucket encrypted? is SSH open?) with auto-remediation |
| **Inspector** | vulnerability scanning of EC2, ECR images and Lambda |
| **Macie** | discovers sensitive data (PANs, PII) in S3 |
| **Detective** | investigation graphs across the above |

Enable them **organization-wide with a delegated administrator** in the security account, all Regions (attackers use the ones you do not watch).

**Response to {{UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS}}**
1. **Triage**: the finding names the role, instance and external IP. Confirm in CloudTrail what the credentials did ({{userIdentity.arn}}, {{sourceIPAddress}}).
2. **Contain the identity**: attach an inline deny to the role for sessions issued before now ({{aws:TokenIssueTime}} condition — the console's "revoke active sessions"). Rotating the role is not enough; issued STS credentials stay valid until expiry.
3. **Contain the host**: swap the instance's security group to an isolation SG (no inbound, no outbound except forensics), detach from the load balancer, snapshot EBS volumes, capture memory if required. Do not terminate first — you destroy evidence.
4. **Eradicate**: find the root cause (SSRF to IMDSv1 is classic — enforce **IMDSv2**), patch, rebuild from a known-good image.
5. **Recover and learn**: restore service, review blast radius (what data did the role reach?), regulatory notification assessment, blameless postmortem, new guardrails (SCP requiring IMDSv2).

**Automate** steps 2-3 with EventBridge rule → Step Functions/Lambda for high-confidence findings, with human approval for destructive actions in prod; send to the SIEM and page the on-call security engineer.`,
  code: r`~~~json
// EventBridge rule in the security account: high-severity credential exfiltration findings -> response workflow
{
  "source": ["aws.guardduty"],
  "detail-type": ["GuardDuty Finding"],
  "detail": {
    "severity": [{ "numeric": [">=", 7] }],
    "type": [{ "prefix": "UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration" }]
  }
}
~~~
~~~json
// Inline policy added to the compromised role: revoke sessions issued before the incident
{ "Version": "2012-10-17",
  "Statement": [{ "Effect": "Deny", "Action": "*", "Resource": "*",
    "Condition": { "DateLessThan": { "aws:TokenIssueTime": "2026-10-11T09:42:00Z" } } }] }
~~~`,
  dia: r`flowchart LR
  CT[CloudTrail, flow logs, DNS] --> GD[GuardDuty]
  GD --> SH[Security Hub - delegated admin]
  GD -->|finding| EB{{EventBridge}}
  EB --> SF[Step Functions response]
  SF -->|1| R[Revoke role sessions]
  SF -->|2| I[Isolation SG + EBS snapshot]
  SF -->|3| P[Page on-call + SIEM ticket]
  CFG[Config rules] --> SH
  INS[Inspector] --> SH`,
  pts: [r`CloudTrail audits; GuardDuty detects; Config checks configuration; Security Hub aggregates.`, r`Enable org-wide, all Regions, with a delegated admin in the security account.`, r`Revoke sessions by token issue time; rotating the role does not kill issued credentials.`, r`Isolate and snapshot before terminating to preserve evidence.`, r`Automate high-confidence containment with EventBridge and Step Functions.`],
  ex: r`An SSRF in a reporting service exposed IMDSv1 credentials; automated session revocation 4 minutes after the GuardDuty finding limited the attacker to listing two buckets, and an IMDSv2 SCP followed.`,
  fu: [r`Which responses would you never fully automate in production, and why?`, r`How do you prove to auditors that detection is enabled in every account and Region?`],
  pit: [r`Enabling GuardDuty only in the Regions you use.`, r`Terminating the instance first and losing forensic evidence.`, r`Assuming rotating keys revokes STS sessions.`] },

{ id: 'q29', level: 'Senior', tags: ['iac', 'cdk', 'terraform', 'cloudformation'],
  q: r`CloudFormation, CDK or Terraform for an AWS estate? Explain state, drift, stack design, and how you safely change stateful resources like databases.`,
  a: r`| | CloudFormation | CDK | Terraform/OpenTofu |
|---|---|---|---|
| Language | YAML/JSON | C#, TypeScript, Python... synthesised to CloudFormation | HCL |
| State | managed by AWS | managed by AWS (via CloudFormation) | state file you store (S3 + locking) |
| Rollback | automatic on failure | same | none built in; plan/apply |
| Scope | AWS only | AWS (plus cdk8s, etc.) | multi-cloud and SaaS (Datadog, GitHub, PagerDuty) |
| New AWS features | usually day one | via L1 immediately, L2 later | provider releases, often fast |

**Choosing**: a .NET-heavy team building AWS-only applications often picks **CDK in C#** — real abstractions, unit-testable, same language. A platform team managing multi-cloud, SaaS and AWS foundations often picks **Terraform**. The worst outcome is a mix with no ownership boundaries.

**State and drift**: IaC only works if it is the **only** writer. Console changes cause **drift**; detect it (CloudFormation drift detection, {{terraform plan}} in a scheduled pipeline) and either import or revert. In prod, humans get read-only console access.

**Stack design**: split by **lifecycle and blast radius** — network, data (long-lived, rarely changed), application (deployed many times a day). Keep stacks small enough that a failed update is understandable; pass values via SSM parameters or stack outputs.

**Changing stateful resources safely**
- Know which property changes cause **replacement** (renaming an RDS instance identifier, changing a DynamoDB key schema). Replacement of a database is data loss.
- Protect them: CloudFormation {{DeletionPolicy: Retain/Snapshot}}, {{UpdateReplacePolicy}}, termination protection; RDS deletion protection; Terraform {{prevent_destroy}}.
- Review the **change set / plan** in the pull request; block merges that show replacement or deletion of stateful resources without explicit approval.
- Schema migrations are application deployments (expand/contract), not IaC.

**Testing**: CDK assertions and snapshot tests, cfn-guard/Checkov/OPA policies in CI (no public buckets, encryption on), and ephemeral environments for integration tests.`,
  code: r`~~~csharp
// CDK (C#): data stack with protection; app stack references it
public class DataStack : Stack
{
    public DatabaseCluster Cluster { get; }

    public DataStack(Construct scope, string id, IVpc vpc, IStackProps props) : base(scope, id, props)
    {
        Cluster = new DatabaseCluster(this, "Ledger", new DatabaseClusterProps
        {
            Engine = DatabaseClusterEngine.AuroraPostgres(new AuroraPostgresClusterEngineProps { Version = AuroraPostgresEngineVersion.VER_16_4 }),
            Writer = ClusterInstance.Provisioned("writer", new ProvisionedClusterInstanceProps { InstanceType = InstanceType.Of(InstanceClass.R7G, InstanceSize.XLARGE) }),
            Readers = [ ClusterInstance.Provisioned("reader1") ],
            Vpc = vpc, VpcSubnets = new SubnetSelection { SubnetGroupName = "data" },
            StorageEncrypted = true, DeletionProtection = true,
            RemovalPolicy = RemovalPolicy.SNAPSHOT,          // never silently delete the ledger
            Backup = new BackupProps { Retention = Duration.Days(35) }
        });
    }
}

// Unit test: fail the build if someone removes deletion protection
var template = Template.FromStack(new DataStack(app, "Data", vpc, props));
template.HasResourceProperties("AWS::RDS::DBCluster", new Dictionary<string, object> { ["DeletionProtection"] = true });
~~~`,
  dia: r`flowchart LR
  PR[Pull request] --> CI[CI: synth, unit tests, cfn-guard / Checkov]
  CI --> CS[Change set or plan posted to PR]
  CS -->|approved, no stateful replacement| D[Deploy: network -> data -> app stacks]
  D --> ENV[(AWS accounts)]
  SCH[Nightly drift detection] --> ENV
  SCH -->|drift found| T[Ticket to owning team]`,
  pts: [r`CDK for .NET-centric AWS apps; Terraform for multi-cloud and SaaS; avoid unowned mixes.`, r`IaC must be the only writer; detect and resolve drift.`, r`Split stacks by lifecycle and blast radius.`, r`Know replacement-causing changes; protect stateful resources with retain/snapshot and deletion protection.`, r`Policy-as-code and plan review in CI.`],
  ex: r`A CDK refactor renamed a construct id and the change set showed replacement of the production DynamoDB table; the pipeline's stateful-replacement check blocked the merge.`,
  fu: [r`How do you import resources created in the console into IaC?`, r`How do you manage Terraform state securely across 100 accounts?`],
  pit: [r`Renaming logical ids and replacing databases.`, r`Console hotfixes in prod that never reach code.`, r`One giant stack for everything.`] },

{ id: 'q30', level: 'Senior', tags: ['cicd', 'oidc', 'ecr', 'supply-chain'],
  q: r`Design a CI/CD pipeline from GitHub to multiple AWS accounts with no long-lived keys: OIDC federation, image build and scanning in ECR, promotion across environments, and approvals that satisfy change management.`,
  a: r`**No stored keys**: GitHub Actions requests an **OIDC token** from GitHub; AWS STS exchanges it via {{AssumeRoleWithWebIdentity}} for a short-lived role session. The role's **trust policy** restricts the {{sub}} claim to the exact repository and branch or environment ({{repo:bank/payments-api:environment:prod}}). A leaked workflow log contains nothing reusable for long.

**Pipeline stages**
1. **Build and test** (.NET restore, build, unit tests, SAST, dependency scanning, secret scanning).
2. **Build the image once**, tag with the commit SHA, push to **ECR** in a shared tooling account; enable **image scanning** (Inspector enhanced scanning) and **tag immutability**; sign images and attach an SBOM.
3. **Deploy to dev** by **digest**, run integration tests.
4. **Promote the same digest** to UAT and prod — never rebuild per environment ("what you tested is what you ship").
5. **Prod deploy**: blue/green or canary with alarm-based rollback (q21).

**Cross-account**: each environment account has a deploy role trusting only the pipeline's identity; ECR repository policy lets workload accounts pull. Prod deploy roles cannot be assumed from feature branches.

**Change management that auditors accept** (SOX/PCI): the evidence is in the system, not in spreadsheets.
- **Protected branches** with required reviews (author cannot approve their own change).
- **GitHub environments** with required reviewers for prod, or an automated change ticket created and linked by the pipeline.
- Immutable logs of who approved, what commit, which digest, when deployed (pipeline logs + CloudTrail + ECR).
- Standard pre-approved changes for low-risk deploys; emergency changes with retrospective review.

**Supply chain**: pin actions by SHA, least-privilege {{permissions:}} in workflows, verify image signatures at deploy time.`,
  code: r`~~~yaml
# .github/workflows/deploy.yml (excerpt)
permissions: { id-token: write, contents: read }
jobs:
  prod:
    runs-on: ubuntu-latest
    environment: prod                              # required reviewers configured on the environment
    steps:
      - uses: aws-actions/configure-aws-credentials@v4   # pin to a commit SHA in real use
        with:
          role-to-assume: arn:aws:iam::444455556666:role/gha-deploy-payments
          aws-region: eu-west-1
      - run: |
          aws ecs update-service --cluster prod --service payments-api \
            --task-definition "$TASK_DEF_ARN" --force-new-deployment
~~~
~~~json
// Trust policy on the prod deploy role: only this repo's prod environment
{ "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::444455556666:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                      "token.actions.githubusercontent.com:sub": "repo:bank/payments-api:environment:prod" } } }
~~~`,
  dia: r`flowchart LR
  GH[GitHub PR merged] --> B[Build + test + SAST]
  B --> IMG[Image tagged with SHA]
  IMG --> ECR[(ECR - immutable tags, scanning, signed)]
  ECR -->|digest| DEV[Dev account deploy]
  DEV -->|same digest| UAT[UAT account]
  UAT -->|environment approval| PRD[Prod account: canary + alarm rollback]
  GH -.OIDC token.-> STS[STS AssumeRoleWithWebIdentity]
  STS -.short-lived creds.-> PRD`,
  pts: [r`OIDC federation with tight sub-claim conditions; no stored AWS keys.`, r`Build once, scan, sign, push to ECR with immutable tags.`, r`Promote the same digest through environments.`, r`Approvals and evidence live in the pipeline: protected branches, environment reviewers, logs.`, r`Pin actions, least-privilege workflow permissions, verify signatures.`],
  ex: r`An audit found 19 long-lived IAM access keys in CI secrets; moving to OIDC removed all of them and the next SOX walkthrough used pipeline logs as change evidence.`,
  fu: [r`What goes wrong if the trust policy uses a wildcard on the sub claim?`, r`How do you handle an emergency hotfix under change control?`],
  pit: [r`Rebuilding images per environment.`, r`Trust policies allowing any branch to assume the prod role.`, r`Mutable latest tags in production.`] },

{ id: 'q31', level: 'Senior', tags: ['auto-scaling', 'ecs', 'sqs-backlog', 'capacity'],
  q: r`Design auto scaling for a .NET API and a queue worker on ECS: target tracking, step scaling, scaling on SQS backlog per task, scheduled and predictive scaling, and why scaling can be too slow.`,
  a: r`**Policy types**
- **Target tracking**: keep a metric at a target (CPU 60%, ALB {{RequestCountPerTarget}} 500). Simple and self-correcting; the default for APIs.
- **Step scaling**: add N tasks when a metric crosses thresholds; useful for aggressive reaction to big jumps.
- **Scheduled**: raise minimums before known peaks (market open, payroll day, month-end).
- **Predictive scaling** (EC2 Auto Scaling, and now ECS): forecasts from history and scales ahead.

**API**: CPU is a weak signal for I/O-bound .NET services; prefer **requests per target** or latency-derived custom metrics. Scale out fast (short cooldown), scale in slowly (avoid flapping).

**Queue worker: backlog per task**
- Metric = {{ApproximateNumberOfMessagesVisible}} ÷ running tasks.
- Acceptable backlog per task = acceptable latency ÷ processing time per message. If a message takes 0.5 s and we accept 60 s of delay: 60 ÷ 0.5 = **120 messages per task**.
- Target-track that custom metric (publish it with a small Lambda or metric math). **KEDA** does the same on EKS.
- Cap **maximum tasks** by the downstream's capacity (DB connections, PSP rate limit), not by queue size.

**Why scaling is too slow**
1. Metric delay: standard CloudWatch metrics at 1-minute resolution, alarms need several datapoints → 2-3 minutes.
2. Provisioning: Fargate task start plus image pull (large .NET images: tens of seconds) plus app warm-up (JIT, connection pools).
3. Health check grace periods and ALB registration.
Total: often **3-6 minutes**. A spike from 1x to 4x in 30 seconds cannot be absorbed by reactive scaling alone.

**Fixes**: keep **headroom** (target 50-60%, not 85%); scheduled minimums for known peaks; smaller images (chiselled/AOT), ReadyToRun, warm-up endpoints; EC2 **warm pools**; load-shed with rate limiting and queue buffering; queue the work so spikes become latency, not errors.`,
  code: r`~~~csharp
// CDK: worker scales on backlog per task; API scales on requests per target
var scaling = workerService.AutoScaleTaskCount(new EnableScalingProps { MinCapacity = 2, MaxCapacity = 30 }); // max set by DB budget

var backlogPerTask = new MathExpression(new MathExpressionProps
{
    Expression = "visible / IF(tasks > 0, tasks, 1)",
    UsingMetrics = new Dictionary<string, IMetric>
    {
        ["visible"] = queue.MetricApproximateNumberOfMessagesVisible(new MetricOptions { Period = Duration.Minutes(1) }),
        ["tasks"] = new Metric(new MetricProps { Namespace = "ECS/ContainerInsights", MetricName = "RunningTaskCount",
            DimensionsMap = new Dictionary<string, string> { ["ClusterName"] = "prod", ["ServiceName"] = "settlement-worker" } })
    }
});
scaling.ScaleToTrackCustomMetric("Backlog", new TrackCustomMetricProps { Metric = backlogPerTask, TargetValue = 120 }); // 60 s / 0.5 s

apiScaling.ScaleOnRequestCount("Rps", new RequestCountScalingProps { RequestsPerTarget = 500, TargetGroup = apiTargetGroup,
    ScaleOutCooldown = Duration.Seconds(60), ScaleInCooldown = Duration.Minutes(5) });
apiScaling.ScaleOnSchedule("MarketOpen", new ScalingSchedule { Schedule = Schedule.Cron(new CronOptions { Hour = "7", Minute = "45", WeekDay = "MON-FRI" }), MinCapacity = 12 });
~~~`,
  dia: r`flowchart LR
  Q[(SQS backlog)] --> M[Metric math: visible / tasks]
  M --> TT[Target tracking: 120 per task]
  TT --> ECS[ECS service tasks 2..30]
  ECS --> DB[(Aurora - connection budget caps max tasks)]
  CW[ALB RequestCountPerTarget] --> API[API service]
  SCH[Scheduled minimum before market open] --> API`,
  pts: [r`Target tracking for APIs on requests per target; CPU is weak for I/O-bound .NET.`, r`Workers scale on backlog per task = acceptable latency / time per message.`, r`Cap max capacity by downstream limits.`, r`Reactive scaling takes minutes: metrics, provisioning, warm-up.`, r`Headroom, scheduled minimums, small images and queue buffering absorb spikes.`],
  ex: r`A broker's order API failed at market open despite auto scaling; a 07:45 scheduled minimum of 12 tasks plus a 55% CPU target removed the 09:00 error spike.`,
  fu: [r`How would you scale on p99 latency safely?`, r`How do you prevent scale-in from killing tasks mid-message?`],
  pit: [r`Scaling workers on CPU.`, r`Unbounded maximum capacity that overloads the database.`, r`Expecting reactive scaling to absorb a 30-second spike.`] },

{ id: 'q32', level: 'Senior', tags: ['s3', 'performance', 'object-lock', 'events'],
  q: r`Use S3 at scale for statements and regulatory archives: request-rate limits and prefixes, multipart upload, event-driven processing, replication, lifecycle, and WORM retention with Object Lock.`,
  a: r`**Request rates**: S3 supports at least **3,500 PUT/COPY/POST/DELETE and 5,500 GET/HEAD requests per second per partitioned prefix**, and scales by partitioning prefixes automatically as load grows. For sudden very high rates, spread keys across prefixes (for example {{statements/2026/10/<hash2>/<accountId>.pdf}}) and retry 503 SlowDown with backoff while S3 repartitions.

**Large objects**: **multipart upload** for anything above about 100 MB (parts 5 MB to 5 GB, max object 5 TB): parallel parts, retry individual parts, and a lifecycle rule to **abort incomplete multipart uploads** (otherwise you pay for invisible parts). **Transfer Acceleration** for distant uploaders; byte-range GETs for parallel downloads.

**Event-driven processing**: S3 event notifications to SQS, SNS, Lambda, or (more flexibly) **EventBridge**. Notifications are at-least-once and can be delayed or duplicated; make processors idempotent on bucket + key + version id (or ETag). For guaranteed completeness, reconcile with **S3 Inventory**.

**Replication**: Cross-Region Replication (CRR) for DR or residency-compliant copies; **Replication Time Control** gives a 15-minute SLA for 99.99% of objects; Same-Region Replication to a separate account protects against account compromise. Replication requires versioning and does not replicate existing objects without Batch Replication.

**Lifecycle**: Standard → Standard-IA after 30 days → Glacier Instant/Flexible Retrieval → Deep Archive for 7-10 year retention; or **Intelligent-Tiering** for unknown access patterns. Expire noncurrent versions.

**WORM with Object Lock** (requires versioning):
- **Governance mode**: protected, but users with a special permission can override.
- **Compliance mode**: nobody, including root, can delete or shorten retention until it expires. S3 Object Lock in compliance mode has been assessed for SEC 17a-4, FINRA and CFTC record-keeping requirements.
- **Legal hold**: indefinite hold for litigation, independent of retention.
Test on a non-production bucket first — compliance-mode mistakes cannot be undone and you pay for storage until retention ends.

**Security**: Block Public Access at the account level, SSE-KMS with S3 Bucket Keys (reduces KMS request cost), bucket policies requiring TLS and your VPC endpoints, Macie for PII discovery.`,
  code: r`~~~csharp
// Archive a trade confirmation with compliance-mode retention (7 years) and a checksum
await s3.PutObjectAsync(new PutObjectRequest
{
    BucketName = "trade-confirms-archive",           // versioning + Object Lock enabled at creation
    Key = $"confirms/{tradeDate:yyyy/MM/dd}/{hashPrefix}/{tradeId}.pdf",
    InputStream = pdf,
    ChecksumAlgorithm = ChecksumAlgorithm.SHA256,
    ServerSideEncryptionMethod = ServerSideEncryptionMethod.AWSKMS,
    ServerSideEncryptionKeyManagementServiceKeyId = archiveKeyArn,
    BucketKeyEnabled = true,
    ObjectLockMode = ObjectLockMode.Compliance,
    ObjectLockRetainUntilDate = tradeDate.AddYears(7).ToUniversalTime()
}, ct);

// Large statement batch file: TransferUtility uses multipart automatically above the threshold
await new TransferUtility(s3).UploadAsync(new TransferUtilityUploadRequest
{
    BucketName = "statement-batches", Key = $"in/{batchId}.csv", FilePath = path, PartSize = 64 * 1024 * 1024
}, ct);
~~~`,
  dia: r`flowchart LR
  U[Batch uploader] -->|multipart| B[(S3 statement-batches)]
  B -->|ObjectCreated| EB{{EventBridge}}
  EB --> Q[(SQS)] --> W[Statement renderer]
  W --> A[(S3 archive - Object Lock compliance)]
  A -->|CRR + RTC| DR[(Archive replica - other Region/account)]
  A -->|lifecycle| G[(Glacier Deep Archive after 1 year)]
  INV[S3 Inventory] -.reconcile.-> W`,
  pts: [r`3,500 writes and 5,500 reads per second per prefix; spread keys and retry 503s.`, r`Multipart for large objects; abort incomplete uploads via lifecycle.`, r`Event notifications are at-least-once; idempotent processors plus Inventory reconciliation.`, r`CRR with RTC for DR; same-Region replication to another account against compromise.`, r`Object Lock compliance mode for WORM retention; test before production.`],
  ex: r`A broker-dealer replaced a tape-based WORM archive with S3 Object Lock in compliance mode plus cross-account replication, and passed a 17a-4 review using the third-party assessment and bucket configuration evidence.`,
  fu: [r`What happens if you set compliance retention to 70 years by mistake?`, r`How do you guarantee every uploaded file was processed?`],
  pit: [r`Assuming S3 events arrive exactly once and in order.`, r`Forgetting to abort incomplete multipart uploads.`, r`Enabling compliance mode on a bucket you have not tested.`] },

{ id: 'q33', level: 'Senior', tags: ['cloudfront', 'cdn', 'cache-keys', 'oac'],
  q: r`Put CloudFront in front of an Angular/React SPA and a .NET API: cache keys and policies, origin access control for S3, caching API responses safely, signed URLs, invalidation, and security headers.`,
  a: r`**Two origins, one distribution**
- **{{/*}} → S3 origin** with the SPA build, accessed through **Origin Access Control (OAC)**: the bucket stays private and only this distribution can read it (bucket policy on {{AWS:SourceArn}}).
- **{{/api/*}} → ALB or API Gateway origin**, HTTPS only, with a secret custom header (or VPC origins, which keep the ALB private) so the origin rejects traffic that bypasses CloudFront.

**Caching the SPA**
- Hashed assets ({{main.3f9a2c.js}}): {{Cache-Control: public, max-age=31536000, immutable}}.
- {{index.html}}: {{no-cache}} or a short TTL, so new deployments take effect immediately.
- SPA routing: a CloudFront Function rewrites extensionless paths to {{/index.html}}, rather than turning every 403/404 into index.html (which hides real errors).

**Cache keys decide correctness**
- The **cache policy** defines the key (path + selected headers, cookies, query strings). The **origin request policy** defines what is forwarded without being in the key.
- **Danger**: caching a personalised response with a key that ignores {{Authorization}} serves one user's data to another. For authenticated APIs use the {{CachingDisabled}} managed policy, or cache only truly public data (FX reference rates, product catalogue) with explicit {{Cache-Control}} from the API.

**Origin Shield** adds a regional caching layer to cut origin load for global audiences.

**Private content**: **signed URLs or signed cookies** (key groups, short expiry) for statement PDFs; or pre-signed S3 URLs for direct downloads.

**Invalidation**: avoid it in the normal flow (versioned asset names); invalidate {{/index.html}} on deploy if TTLs are long. The first 1,000 invalidation paths per month are free.

**Security**: WAF on the distribution (managed rules, rate-based rules, bot control), Shield Standard, TLS 1.2+ security policy, a **response headers policy** adding HSTS, CSP, X-Content-Type-Options, frame-ancestors; field-level encryption for sensitive form fields if needed.`,
  code: r`~~~csharp
// .NET API: tell CloudFront exactly what is cacheable
app.MapGet("/api/v1/fx/reference-rates", async (IRatesService svc) =>
{
    var rates = await svc.GetReferenceRatesAsync();
    return Results.Ok(rates);
}).CacheOutput(p => p.Expire(TimeSpan.FromSeconds(30)))                 // in-process too
  .AddEndpointFilter(async (ctx, next) =>
  {
      ctx.HttpContext.Response.Headers.CacheControl = "public, max-age=30, s-maxage=30";
      return await next(ctx);
  });

app.MapGet("/api/v1/accounts/{id}", GetAccount)
   .RequireAuthorization()
   .AddEndpointFilter(async (ctx, next) =>
   {
       ctx.HttpContext.Response.Headers.CacheControl = "private, no-store";  // never cached by a shared cache
       return await next(ctx);
   });
~~~`,
  dia: r`flowchart LR
  B[Browser] -->|TLS| CF[CloudFront + WAF + headers policy]
  CF -->|default behaviour, OAC| S3[(S3: SPA assets - private)]
  CF -->|/api/* - CachingDisabled| ALB[ALB or API Gateway]
  CF -->|/api/v1/fx/* - 30 s cache| ALB
  ALB --> API[.NET API on ECS]
  CF -->|signed URL| ST[(Statements bucket)]`,
  pts: [r`One distribution, S3 via OAC for the SPA, API origin locked to CloudFront.`, r`Hashed assets cached for a year; index.html not cached.`, r`Cache key must include anything that changes the response; disable caching for personalised APIs.`, r`Signed URLs or cookies for private content.`, r`WAF, TLS policy and a response headers policy at the edge.`],
  ex: r`A retail bank briefly served cached account summaries to the wrong users because a cache policy omitted the Authorization header; switching /api/* to CachingDisabled and adding private, no-store from the API closed it.`,
  fu: [r`How do you deploy a new SPA version without users loading mismatched chunks?`, r`Why prefer a CloudFront Function rewrite over custom error responses for SPA routing?`],
  pit: [r`Caching authenticated responses with a key that ignores identity.`, r`Long TTL on index.html.`, r`Public S3 website buckets instead of OAC.`] },

{ id: 'q34', level: 'Senior', tags: ['throttling', 'quotas', 'retries', 'sdk'],
  q: r`AWS APIs throttle. Explain service quotas, the SDK retry modes, exponential backoff with jitter, and how to design a .NET service that degrades gracefully instead of amplifying a throttling event.`,
  a: r`**Quotas**: every service has per-account, per-Region limits — some on resources (VPCs per Region), many on **request rates** (KMS cryptographic operations per second, Secrets Manager {{GetSecretValue}}, STS, EC2 describe calls, DynamoDB table throughput, Lambda concurrency). Exceeding them returns throttling errors ({{ThrottlingException}}, {{TooManyRequestsException}}, {{ProvisionedThroughputExceededException}}, HTTP 429/503 SlowDown).
- Track them with **Service Quotas** and CloudWatch usage metrics; alarm at 70-80% of a quota; request increases ahead of launches; remember quotas are per account, so account-per-workload multiplies headroom.

**SDK retry modes (AWS SDK for .NET)**
- **Standard**: exponential backoff with jitter, a retry quota (token bucket) so a client stops retrying when most calls fail, default 3 attempts.
- **Adaptive**: standard plus client-side rate limiting that slows the client when it sees throttling. Good for batch jobs hammering one API.
- **Legacy**: older behaviour; avoid for new code.

**Why jitter**: 500 tasks that fail together and retry after exactly 1, 2, 4 s produce synchronised waves. Full jitter (sleep random(0, base × 2^attempt)) spreads them out.

**Designing so throttling does not cascade**
- **Cache** what you call repeatedly: secrets (Secrets Manager caching client), KMS data keys (envelope encryption with data-key caching), STS credentials (SDK does this), configuration.
- **Batch** APIs: {{SendMessageBatch}}, {{PutRecords}}, {{BatchWriteItem}} — and handle partial failures.
- **Budget retries end to end**: if the API call already has 3 SDK retries, do not wrap it in a Polly policy with 5 more and an outer client retry with 3 more (3 × 5 × 3 = 45 calls per user request).
- **Timeouts and circuit breakers** around dependencies; fail fast with a clear error.
- **Queue** non-urgent work so a throttled downstream becomes latency, not errors.
- **Spread start-up**: 300 pods fetching secrets at the same second after a deploy is a self-inflicted throttle.`,
  code: r`~~~csharp
// SDK clients with adaptive retry and explicit timeouts
var cfg = new AmazonKeyManagementServiceConfig
{
    RetryMode = RequestRetryMode.Adaptive,      // client-side rate limiting on throttles
    MaxErrorRetry = 4,
    Timeout = TimeSpan.FromSeconds(2)
};
builder.Services.AddSingleton<IAmazonKeyManagementService>(new AmazonKeyManagementServiceClient(cfg));

// Cache secrets instead of calling GetSecretValue per request
builder.Services.AddSingleton<ISecretsManagerCache>(sp =>
    new SecretsManagerCache(sp.GetRequiredService<IAmazonSecretsManager>(),
        new SecretCacheConfiguration { CacheItemTTL = 300_000 }));   // 5 minutes

// Outer policy: no extra retries on top of the SDK, just a circuit breaker + timeout
builder.Services.AddResiliencePipeline("kms", p => p
    .AddCircuitBreaker(new() { FailureRatio = 0.5, MinimumThroughput = 20, BreakDuration = TimeSpan.FromSeconds(15) })
    .AddTimeout(TimeSpan.FromSeconds(3)));
~~~`,
  dia: r`flowchart LR
  REQ[User request] --> APP[.NET service]
  APP -->|cache hit| C[Secret / data-key cache]
  APP -->|miss| SDK[SDK: adaptive retry, jitter, retry quota]
  SDK --> AWS[KMS / Secrets Manager]
  AWS -->|429 throttle| SDK
  APP --> CB[Circuit breaker - fail fast]
  APP -->|non-urgent| Q[(SQS buffer)]`,
  pts: [r`Request-rate quotas are per account and Region; monitor and raise them early.`, r`Standard or adaptive SDK retry modes with jitter and a retry quota.`, r`Cache secrets, data keys and config; batch API calls.`, r`Budget retries across layers to avoid multiplication.`, r`Circuit breakers, timeouts and queues turn throttling into latency, not outages.`],
  ex: r`A card-tokenisation service called KMS Decrypt per request and hit the KMS rate quota during a sale; data-key caching cut KMS calls by 99% and removed the throttling.`,
  fu: [r`How do you find which code path is causing KMS throttling?`, r`When is adaptive retry mode a bad idea?`],
  pit: [r`Stacking Polly retries on SDK retries on client retries.`, r`Calling Secrets Manager or KMS on every request.`, r`Retrying without jitter.`] },

{ id: 'q35', level: 'Senior', tags: ['incident', 'debugging', 'latency', 'rds-proxy'],
  q: r`Incident: after a deploy, a payments API on ECS shows p99 latency rising from 120 ms to 4 s and intermittent 5xx; CPU is only 35%. How do you investigate with AWS tooling, and what are the likely root causes?`,
  a: r`**First 5 minutes: stabilise.** The change correlates with a deploy, so **roll back** (blue/green switch or previous task definition) while you investigate. Restore service first; diagnose second.

**Narrow down with the data you already have**
1. **ALB metrics**: {{TargetResponseTime}} p99 and {{HTTPCode_Target_5XX_Count}} vs {{HTTPCode_ELB_5XX_Count}}. Target 5xx = the app; ELB 502/504 = connection or timeout between ALB and targets.
2. **Traces** (X-Ray/Application Signals): which segment grew? If the time sits in "database" or "PSP" spans, it is a dependency; if spans are short but total time is long, requests are **queuing inside the app**.
3. **Container Insights / runtime metrics**: low CPU with high latency on .NET points to **thread-pool starvation** — rising {{dotnet.thread_pool.queue.length}}, thread count climbing slowly (about one new thread per second when starved), and GC pauses.
4. **Database**: RDS **Performance Insights** — {{DatabaseConnections}} near max, top waits (locks, I/O), new slow queries.
5. **Logs**: CloudWatch Logs Insights for errors and timeouts by endpoint and task.

**Likely root causes in this pattern**
- **Sync-over-async** introduced in the deploy ({{.Result}}, {{.Wait()}}, {{GetAwaiter().GetResult()}} on a hot path) → thread-pool starvation; CPU stays low because threads are blocked waiting.
- **Connection pool exhaustion**: a missing {{await using}}/dispose or a long transaction holds connections; requests wait for the pool (EF Core/Npgsql "timeout while getting a connection").
- **A new N+1 query** or missing index → DB CPU and lock waits.
- **HttpClient misuse** (new client per call → socket exhaustion, SNAT/NAT port limits; check NAT Gateway {{ErrorPortAllocation}}).
- **Downstream timeout too long** (PSP 30 s timeout with no circuit breaker) → requests pile up.

**Confirming .NET starvation**: {{dotnet-counters}} via ECS Exec, or a {{dotnet-dump}} showing many threads blocked in {{Task.Wait}}.

**Fix and prevent**: remove the blocking call; set pool limits and timeouts deliberately; add canary analysis on p99 latency so the next bad deploy rolls back automatically; load test with production-shaped traffic; alarms on thread-pool queue length and DB connection usage.`,
  code: r`~~~csharp
// The bug that shipped: blocking on async in a hot path
public PaymentResult Authorize(PaymentRequest req)
{
    var risk = _riskClient.ScoreAsync(req).Result;   // blocks a thread-pool thread for each request
    return _processor.Authorize(req, risk);
}

// Fix: async all the way, bounded dependency timeout
public async Task<PaymentResult> AuthorizeAsync(PaymentRequest req, CancellationToken ct)
{
    using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
    cts.CancelAfter(TimeSpan.FromMilliseconds(800));
    var risk = await _riskClient.ScoreAsync(req, cts.Token);
    return await _processor.AuthorizeAsync(req, risk, ct);
}
~~~
~~~text
# CloudWatch Logs Insights: errors and slow requests by endpoint after the deploy
fields @timestamp, path, statusCode, durationMs, taskId
| filter durationMs > 1000 or statusCode >= 500
| stats count(*) as n, pct(durationMs, 99) as p99 by path, bin(1m)
| sort n desc
~~~`,
  dia: r`flowchart TD
  A[Alert: p99 4 s, 5xx] --> RB[Roll back deploy]
  RB --> M{ALB: target 5xx or ELB 5xx?}
  M -->|target| T[Traces: which span grew?]
  M -->|ELB 502/504| K[Keep-alive / timeouts / task health]
  T -->|dependency span| D[Performance Insights, PSP latency]
  T -->|short spans, long total| S[Thread-pool starvation? dotnet-counters]
  S --> F[Find sync-over-async in the diff]`,
  pts: [r`Roll back first when the incident correlates with a deploy.`, r`Separate target 5xx from ELB 5xx; use traces to locate time.`, r`Low CPU plus high latency in .NET suggests thread-pool starvation or pool exhaustion.`, r`Check DB connections and waits in Performance Insights; NAT port errors for HttpClient misuse.`, r`Prevent with canary analysis on p99 and alarms on saturation signals.`],
  ex: r`A card-authorisation API's latency jumped after a library upgrade introduced a synchronous token fetch; thread-pool queue length alarms and a canary on p99 now catch this class of bug within 5 minutes.`,
  fu: [r`How would you use ECS Exec to collect a dump safely in production?`, r`Why does the thread pool inject threads slowly, and why doesn't raising MinThreads fix the root cause?`],
  pit: [r`Scaling out instead of rolling back.`, r`Assuming low CPU means the app is fine.`, r`Debugging in production for an hour before restoring service.`] },

{ id: 'q36', level: 'Senior', tags: ['resilience', 'availability-zones', 'static-stability', 'arc'],
  q: r`Design a service to survive an Availability Zone failure, including partial "gray" failures. Explain static stability, zonal shift with Application Recovery Controller, cross-zone load balancing, and how you test it.`,
  a: r`**Static stability**: the system keeps working during a failure **without needing to change anything** — no scaling actions, no control-plane calls, no new resources. Concretely:
- Run across **three AZs** with enough capacity that **losing one leaves enough**: for a peak needing 12 tasks, run 6 per AZ (18 total), not 4 per AZ. (n AZs → provision peak × n/(n−1)).
- Databases already Multi-AZ (Aurora replicas in other AZs, RDS Multi-AZ standby, DynamoDB/S3/SQS are regional by design).
- Avoid relying on control planes during recovery (creating instances, changing DNS records, IAM changes) — data planes are designed for higher availability than control planes.

**Gray failures**: an AZ that is not down but degraded (packet loss, high latency on one subnet) passes simple health checks. Shallow health checks keep sending traffic there; deep health checks can fail every target at once on a shared dependency blip. Detect **per-AZ** outlier metrics (latency and errors by AZ) instead.

**Zonal shift (ARC)**: move ALB/NLB traffic away from an impaired AZ for a chosen time, with one API call, without touching DNS records you manage. **Zonal autoshift** lets AWS shift away automatically when it detects an AZ impairment; you must have capacity to absorb it and run **practice runs**, which ARC schedules for you.

**Cross-zone load balancing**: on for ALB (always), optional for NLB. Cross-zone spreads load evenly but means an impaired AZ's clients reach every zone and vice versa; zonal isolation (cross-zone off, AZ-affine routing) contains failure better but needs even capacity per AZ. Know the trade-off you chose.

**AZ-independent architecture**: keep request paths within one AZ where possible (AZ-local caches, readers, service discovery), so an AZ failure removes a slice rather than adding cross-AZ latency everywhere.

**Testing**: **AWS Fault Injection Service** experiments — stop tasks in one AZ, inject network latency or packet loss, trigger Aurora failover, run the FIS AZ power-interruption scenario — in pre-prod and, with guardrails and stop conditions, in prod. Validate that SLOs hold, alarms fire and runbooks work.`,
  code: r`~~~bash
# Shift traffic away from an impaired AZ for 2 hours (ARC zonal shift)
aws arc-zonal-shift start-zonal-shift \
  --resource-identifier arn:aws:elasticloadbalancing:eu-west-1:111122223333:loadbalancer/app/payments-alb/abc123 \
  --away-from euw1-az2 \
  --expires-in 2h \
  --comment "Elevated p99 and 5xx in euw1-az2 - INC-4821"
~~~
~~~json
// FIS experiment (excerpt): stop one third of ECS tasks in one AZ, with an SLO-based stop condition
{
  "targets": { "tasks": { "resourceType": "aws:ecs:task", "selectionMode": "PERCENT(100)",
      "parameters": { "cluster": "prod", "service": "payments-api", "availabilityZoneIdentifier": "euw1-az2" } } },
  "actions": { "stopTasks": { "actionId": "aws:ecs:stop-task", "targets": { "Tasks": "tasks" } } },
  "stopConditions": [{ "source": "aws:cloudwatch:alarm", "value": "arn:aws:cloudwatch:eu-west-1:111122223333:alarm:payments-slo-burn" }]
}
~~~`,
  dia: r`flowchart TB
  ALB[ALB - zonal shift capable]
  subgraph AZa[AZ a]
    T1[6 tasks]
    R1[(Aurora reader)]
  end
  subgraph AZb[AZ b - impaired]
    T2[6 tasks]
    W[(Aurora writer)]
  end
  subgraph AZc[AZ c]
    T3[6 tasks]
    R2[(Aurora reader)]
  end
  ALB --> T1
  ALB -.shifted away.-> T2
  ALB --> T3
  W -.failover promotes.-> R1`,
  pts: [r`Static stability: survive AZ loss with pre-provisioned capacity and no control-plane actions.`, r`Provision peak x n/(n-1) across n AZs.`, r`Detect gray failures with per-AZ metrics, not just health checks.`, r`ARC zonal shift and autoshift move traffic away quickly; practice runs prove capacity.`, r`Test with Fault Injection Service experiments and SLO stop conditions.`],
  ex: r`During an AZ network degradation, a payments team shifted traffic away within 4 minutes using ARC; because they ran 150% capacity, latency stayed within SLO with no scaling actions.`,
  fu: [r`Should cross-zone load balancing be on for an NLB in front of a payments service?`, r`How do you run FIS experiments in production without breaching SLAs?`],
  pit: [r`Running at 100% of peak across three AZs and expecting to survive one loss.`, r`Recovery plans that depend on creating resources during the event.`, r`Deep health checks that fail every target on a shared dependency blip.`] },

{ id: 'q37', level: 'Principal', tags: ['disaster-recovery', 'multi-region', 'rpo-rto'],
  q: r`Choose and design a multi-Region disaster recovery strategy for a payments platform: backup/restore, pilot light, warm standby or active-active. How do RPO/RTO, data replication and failover decisions drive the choice?`,
  a: r`**Start from business numbers, not technology.** Ask the business and regulators: maximum tolerable data loss (**RPO**) and downtime (**RTO**) per capability. Card authorisation might need RTO 15 minutes and RPO near zero; statement generation might tolerate a day.

| Strategy | RTO | RPO | Cost | Notes |
|---|---|---|---|---|
| Backup & restore | hours | hours (last backup) | lowest | AWS Backup cross-Region/cross-account copies; rebuild with IaC |
| Pilot light | tens of minutes to hours | seconds-minutes | low | data replicated live; compute off or minimal |
| Warm standby | minutes | seconds | medium | scaled-down full stack running; scale up on failover |
| Active-active | near zero | near zero to seconds | highest | both Regions serve traffic; hardest data model |

**Data replication is the real design**
- **Aurora Global Database**: storage-level replication, typically under 1 second lag; managed switchover (planned, no data loss) and failover (unplanned, RPO = replication lag). Writes in one Region only (write forwarding helps reads-mostly apps).
- **DynamoDB global tables**: multi-active, last writer wins — partition writes by home Region for money.
- **S3 CRR with RTC**, ECR replication, Secrets Manager replica secrets, KMS multi-Region keys.
- **Messaging**: queues are regional. In-flight messages in the failed Region are lost or stranded — the **outbox in a replicated database** lets the new Region re-publish; consumers must be idempotent.

**Failover mechanics**
- Prefer **data-plane** failover: Route 53 health-checked failover records or **ARC routing controls** (highly available on/off switches) instead of editing DNS during an incident.
- **Decide, do not auto-flap**: automatic failover for stateless tiers, human decision (with a pre-approved runbook) for the database primary, because split brain on a ledger is worse than 10 minutes of downtime.
- Fence the old Region (stop its writers) before promoting the new one.

**Prove it**: game days with real failovers at least twice a year; measure actual RTO/RPO; DR-account backups with restricted delete (AWS Backup Vault Lock) against ransomware. An untested DR plan is an assumption, and regulators (DORA, PRA, OCC) increasingly ask for evidence.`,
  code: r`~~~bash
# Planned Region switchover for Aurora Global Database (no data loss)
aws rds switchover-global-cluster \
  --global-cluster-identifier ledger-global \
  --target-db-cluster-identifier arn:aws:rds:eu-central-1:111122223333:cluster:ledger-fra

# Unplanned: fail over and accept RPO = replication lag at the time of failure
aws rds failover-global-cluster \
  --global-cluster-identifier ledger-global \
  --target-db-cluster-identifier arn:aws:rds:eu-central-1:111122223333:cluster:ledger-fra \
  --allow-data-loss

# Flip traffic with ARC routing controls (data-plane API, works during control-plane impairment)
aws route53-recovery-cluster update-routing-control-states --endpoint-url https://<cluster-endpoint> \
  --update-routing-control-state-entries \
  RoutingControlArn=arn:...:routingcontrol/dub,RoutingControlState=Off \
  RoutingControlArn=arn:...:routingcontrol/fra,RoutingControlState=On
~~~`,
  dia: r`flowchart LR
  U[Clients] --> R53[Route 53 + ARC routing controls]
  R53 -->|active| P[eu-west-1: full stack]
  R53 -.standby.-> S[eu-central-1: warm standby, scaled down]
  P --> AP[(Aurora primary)]
  AP -->|storage replication under 1 s| AS[(Aurora secondary)]
  S --> AS
  P --> S3P[(S3)] -->|CRR + RTC| S3S[(S3 replica)]
  P --> BK[AWS Backup] -->|cross-account vault lock| V[(DR backup vault)]`,
  pts: [r`RPO and RTO per capability drive the strategy and its cost.`, r`Backup/restore, pilot light, warm standby, active-active trade cost for recovery speed.`, r`Data replication is the hard part: Aurora Global, global tables, CRR, outbox re-publish.`, r`Data-plane failover via ARC; human decision for promoting the ledger; fence the old Region.`, r`Game days measure real RTO/RPO; vault-locked backups protect against ransomware.`],
  ex: r`A card issuer ran warm standby in eu-central-1 and practised quarterly; a real regional impairment was handled in 22 minutes against a 30-minute RTO, with outbox replay re-publishing 3,100 events.`,
  fu: [r`What would make you choose active-active for the ledger?`, r`How do you handle messages in flight in the failed Region?`],
  pit: [r`Choosing active-active without a conflict-free data model.`, r`DR plans that need control-plane actions during a regional event.`, r`Never testing failover.`] },

{ id: 'q38', level: 'Principal', tags: ['system-design', 'payments', 'reference-architecture'],
  q: r`Design a card-payment acceptance platform on AWS for 2,000 TPS peak, 99.99% availability, PCI DSS scope, EU data residency and no double charges. Walk through the architecture and the key decisions.`,
  a: r`**Scope and numbers**: 2,000 TPS peak, about 50 million payments a day at most, 99.99% ≈ 4.3 minutes of downtime a month. The load is modest for AWS; the hard problems are **correctness (no double charge), PCI scope, and availability across failures**.

**Request path**
1. **Route 53 → CloudFront + WAF** (rate limits, bot control) → **API Gateway or ALB** with mTLS for merchants.
2. **Payments API** (ECS Fargate, three AZs, static stability at 150% capacity) validates, requires an **{{Idempotency-Key}}**, and writes the payment as {{PENDING}} plus an outbox row in **Aurora PostgreSQL** in one transaction.
3. **Tokenisation** happens in a separate **cardholder-data environment (CDE) account**: PANs go only to a tokenisation service (KMS/CloudHSM-backed), everything else sees tokens. Better still, hosted fields/iframes keep raw PANs off your servers entirely.
4. **Authorisation**: a PSP adapter calls the acquirer/PSP with the same idempotency key, stores the result, moves the payment to {{AUTHORISED}} or {{DECLINED}}.
5. **Outbox relay → EventBridge/SNS → SQS queues** for ledger, notifications, fraud features, reporting.
6. **Ledger service**: double-entry postings in Aurora, append-only, idempotent on payment id.
7. **Nightly reconciliation**: PSP settlement files land in S3 → Step Functions job compares with the ledger → breaks classified and routed.

**Key decisions and why**
- **Aurora PostgreSQL over DynamoDB for the core**: relational integrity for a ledger, rich reconciliation queries, transactions; 2,000 TPS is comfortably within one writer. DynamoDB for the idempotency store is a reasonable alternative.
- **ECS Fargate over EKS**: smaller platform burden for a focused team.
- **Accounts as PCI boundaries**: CDE account with tight SCPs, separate network, separate keys; the rest out of scope.
- **EU Regions only** via SCP Region-deny; warm standby in a second EU Region.

**Correctness**: idempotency keys at the API and towards the PSP; unknown outcomes (timeouts) go to {{UNKNOWN}} and are resolved by status query or reconciliation — **never blindly retried as a new charge**.

**Operations**: SLOs on authorisation latency and success rate, per-PSP circuit breakers with failover to a second PSP, CloudTrail and Config in a log-archive account, quarterly DR tests.`,
  code: r`~~~sql
-- Aurora PostgreSQL: payment + idempotency + outbox written atomically
CREATE TABLE payment (
  payment_id      uuid PRIMARY KEY,
  merchant_id     text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash    bytea NOT NULL,
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),   -- integer minor units, never float
  currency        char(3) NOT NULL,
  card_token      text NOT NULL,                               -- token from the CDE, never a PAN
  status          text NOT NULL CHECK (status IN ('PENDING','AUTHORISED','DECLINED','UNKNOWN','CAPTURED','REFUNDED')),
  psp_reference   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, idempotency_key)                        -- the double-charge guard
);
CREATE TABLE outbox (
  id bigserial PRIMARY KEY, aggregate_id uuid NOT NULL, event_type text NOT NULL,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
~~~`,
  dia: r`flowchart LR
  M[Merchant / checkout] --> CF[CloudFront + WAF]
  CF --> GW[API Gateway - mTLS]
  GW --> API[Payments API - ECS, 3 AZs]
  M -->|hosted fields| TOK[Tokenisation - CDE account, HSM]
  API --> DB[(Aurora PostgreSQL: payment + outbox)]
  API --> PSP[PSP adapter] --> EXT[PSP / acquirer]
  DB --> REL[Outbox relay] --> EB{{EventBridge}}
  EB --> LQ[(ledger queue)] --> LED[Ledger - double entry]
  EB --> NQ[(notify queue)]
  EB --> FQ[(fraud features)]
  SF[Settlement files - S3] --> REC[Step Functions reconciliation]
  REC --> LED`,
  pts: [r`2,000 TPS is modest; correctness, PCI scope and availability are the design drivers.`, r`Idempotency key + unique constraint + outbox in one transaction.`, r`CDE in its own account; tokens everywhere else; hosted fields reduce scope further.`, r`UNKNOWN outcomes are resolved by status query or reconciliation, never re-charged.`, r`Aurora for the ledger, Fargate across three AZs, warm standby in a second EU Region.`],
  ex: r`A European acquirer using this shape processed Black Friday at 3,100 TPS; a PSP outage triggered circuit-breaker failover to the secondary PSP and reconciliation showed zero duplicate charges.`,
  fu: [r`How do you handle a PSP timeout where the charge may have succeeded?`, r`What changes if the business needs multi-currency settlement?`],
  pit: [r`Floating-point money.`, r`Retrying a timed-out authorisation without the same idempotency key.`, r`Letting PANs reach general application logs or services.`] },

{ id: 'q39', level: 'Principal', tags: ['finops', 'cost-optimization', 'savings-plans'],
  q: r`Your AWS bill grew 70% in a year while traffic grew 20%. How do you run cost optimisation as a Principal Engineer: visibility, quick wins, commitments, architecture changes and governance?`,
  a: r`**1. Visibility first**
- **Tagging standard** enforced by policy ({{cost-center}}, {{service}}, {{env}}, {{owner}}) and activated as cost allocation tags; account-per-workload makes attribution natural.
- **Cost and Usage Report** (CUR 2.0/Data Exports) to S3 → Athena/QuickSight; Cost Explorer for trends; **Cost Anomaly Detection** alerts.
- **Unit economics**: cost per payment, per active customer, per 1,000 API calls. A rising bill with a falling cost per payment is healthy; the reverse is the real signal.

**2. Quick wins (weeks)**
- Rightsize with **Compute Optimizer** (EC2, ECS on Fargate, Lambda memory, EBS).
- Delete idle resources: unattached EBS volumes, old snapshots, idle load balancers, forgotten dev environments; **schedule non-prod** off nights and weekends (about 65% fewer hours).
- **gp2 → gp3** volumes (about 20% cheaper, independent IOPS).
- **NAT Gateway data processing**: add S3/DynamoDB gateway endpoints and interface endpoints for heavy services (q24).
- CloudWatch Logs retention and verbosity; S3 lifecycle and Intelligent-Tiering.

**3. Commitments**
- **Compute Savings Plans** (up to about 66% off, flexible across EC2, Fargate and Lambda) for the steady baseline; EC2 Instance Savings Plans/RIs (up to about 72%) where the family is stable; **RDS/ElastiCache reserved nodes**.
- Commit to the baseline you are sure of (for example 70-80% of the steady minimum); re-evaluate quarterly.

**4. Architecture (months)**
- **Graviton** (ARM) for .NET 8+ containers and Lambda: often around 20-40% better price-performance, usually a rebuild with no code change.
- **Spot** for stateless workers, CI runners and batch (up to 90% off) with interruption handling.
- Fewer cross-AZ and cross-Region bytes (chatty services, replication you do not need).
- Right storage tier; serverless where utilisation is low; consolidate under-used clusters.

**5. Governance**: monthly cost reviews per team with their unit metrics, budgets with alerts, cost visible in pull requests (Infracost) for infrastructure changes, a FinOps champion per domain. **Cost is a non-functional requirement**, owned by engineering, not a finance surprise.`,
  code: r`~~~sql
-- Athena over CUR 2.0: monthly cost per service tag, and cost per payment
SELECT date_trunc('month', line_item_usage_start_date)            AS month,
       resource_tags['user_service']                               AS service,
       round(sum(line_item_unblended_cost), 2)                     AS cost_usd
FROM   cur2.data
WHERE  line_item_usage_start_date >= date '2026-01-01'
GROUP  BY 1, 2
ORDER  BY 1, 3 DESC;

-- Join with business volume to track unit cost
SELECT c.month, c.cost_usd / p.payments AS cost_per_payment
FROM   monthly_cost c JOIN monthly_payments p ON p.month = c.month
WHERE  c.service = 'payments-platform';
~~~`,
  dia: r`flowchart LR
  TAG[Tag policy + account per workload] --> CUR[Cost and Usage Report]
  CUR --> ATH[Athena / QuickSight: unit costs]
  ATH --> REV[Monthly team cost review]
  REV --> QW[Quick wins: rightsizing, idle, gp3, endpoints]
  REV --> COM[Savings Plans on steady baseline]
  REV --> ARC[Architecture: Graviton, Spot, data transfer]
  AD[Cost Anomaly Detection] --> REV`,
  pts: [r`Visibility through tags, accounts, CUR and unit economics first.`, r`Quick wins: rightsizing, idle resources, non-prod schedules, gp3, VPC endpoints, log retention.`, r`Savings Plans and reservations for the proven baseline only.`, r`Graviton, Spot and data-transfer reduction for structural savings.`, r`Governance: team reviews, budgets, cost in pull requests.`],
  ex: r`A payments group cut its bill 34% in two quarters: 11% from idle and non-prod schedules, 9% from Savings Plans, 8% from Graviton, 6% from NAT and logging changes; cost per payment fell from 0.9 to 0.55 cents.`,
  fu: [r`How much of the baseline would you commit to, and for how long?`, r`How do you make teams care about cost without slowing delivery?`],
  pit: [r`Buying three-year commitments before rightsizing.`, r`Optimising total cost while ignoring unit economics.`, r`One-off clean-ups with no governance, so costs creep back.`] },

{ id: 'q40', level: 'Principal', tags: ['migration', 'legacy-dotnet', '7rs', 'strangler'],
  q: r`Plan the migration of a 15-year-old .NET Framework 4.8 monolith on Windows and SQL Server to AWS. Which of the 7 Rs, in what order, and how do you avoid a big-bang cut-over?`,
  a: r`**The 7 Rs**: retire, retain, rehost (lift and shift), relocate, replatform (lift and reshape), repurchase (SaaS), refactor (re-architect).

**Discovery first**: dependency mapping (Application Discovery Service, Migration Evaluator for TCO), Windows/SQL licensing position, integrations (MSMQ, file shares, COM, scheduled tasks, AD/Kerberos), compliance constraints. Retire what nobody uses — often 10-20% of a portfolio.

**A phased plan for the monolith**
1. **Rehost or replatform quickly** to exit the data centre: Windows EC2 (Application Migration Service) or Windows containers on ECS; SQL Server on **RDS for SQL Server** (managed backups, Multi-AZ) or EC2 if you need features RDS lacks. This buys time, not modernisation.
2. **Port to modern .NET** (.NET 8/10 LTS) using the .NET Upgrade Assistant and AWS Transform for .NET / porting tooling: replace System.Web, WCF server (CoreWCF or gRPC/REST), configuration and DI. Moving to Linux containers removes Windows licence cost and enables Graviton.
3. **Strangler fig**: put an ALB or API gateway in front; route one capability at a time (for example statements, then notifications) to new services; the monolith shrinks. Use events from the monolith (CDC with DMS or an outbox) to feed new services.
4. **Database decomposition last**: each new service owns its data; keep a synchronisation path during transition. Consider **Aurora PostgreSQL** to drop SQL Server licences — Babelfish can reduce T-SQL rewrite effort, but test compatibility thoroughly; stored-procedure-heavy systems are the real cost.

**Avoiding big bang**
- Run old and new in parallel with **shadow traffic** or dual-run comparisons for critical calculations (fees, interest).
- Database migration with **DMS full load + CDC**, cut over per capability with a short write freeze, and a tested rollback (reverse replication).
- Feature flags and per-tenant or per-region routing for gradual cut-over.

**Principal concerns**: a business case with milestones (data-centre exit date, licence savings), team upskilling, an explicit list of what will not be modernised, and stop points where the organisation can pause with value delivered.`,
  code: r`~~~csharp
// Strangler routing at the edge (YARP in a .NET 8 gateway): move /statements to the new service
builder.Services.AddReverseProxy().LoadFromMemory(
    routes:
    [
        new RouteConfig { RouteId = "statements-new", ClusterId = "statements-svc",
                          Match = new RouteMatch { Path = "/api/statements/{**rest}" } },
        new RouteConfig { RouteId = "legacy", ClusterId = "monolith", Order = 1000,
                          Match = new RouteMatch { Path = "{**catch-all}" } }
    ],
    clusters:
    [
        new ClusterConfig { ClusterId = "statements-svc",
            Destinations = new Dictionary<string, DestinationConfig> { ["d1"] = new() { Address = "http://statements.internal/" } } },
        new ClusterConfig { ClusterId = "monolith",
            Destinations = new Dictionary<string, DestinationConfig> { ["d1"] = new() { Address = "http://legacy-alb.internal/" } } }
    ]);
~~~`,
  dia: r`flowchart LR
  U[Users] --> GW[Gateway / ALB - strangler routing]
  GW -->|/api/statements| NS[Statements service - .NET 8, Linux, ECS]
  GW -->|everything else| MONO[Monolith - .NET Framework on Windows EC2]
  MONO --> SQL[(RDS SQL Server)]
  SQL -->|DMS CDC| NDB[(Aurora PostgreSQL - statements data)]
  NS --> NDB`,
  pts: [r`Discover and retire first; map dependencies and licensing.`, r`Rehost/replatform to exit the data centre, then port to modern .NET.`, r`Strangler fig behind a gateway; move one capability at a time.`, r`Decompose the database last, with DMS CDC and tested rollback.`, r`Parallel runs and feature flags instead of a big-bang cut-over.`],
  ex: r`An insurer lifted a .NET Framework policy system to EC2 in 4 months to exit a data centre, then strangled 9 capabilities into .NET 8 services over 2 years, cutting Windows and SQL Server licences by 60%.`,
  fu: [r`How do you migrate a system heavy with stored procedures?`, r`When is rehost-only the right final answer?`],
  pit: [r`Big-bang rewrites.`, r`Ignoring SQL Server licensing in the business case.`, r`Splitting services but keeping one shared database forever.`] },

{ id: 'q41', level: 'Principal', tags: ['pci-dss', 'compliance', 'data-residency', 'audit'],
  q: r`How do you meet PCI DSS, SOX change control and data-residency requirements on AWS? Explain the shared responsibility for compliance, scope reduction, and how you produce audit evidence continuously.`,
  a: r`**Shared responsibility for compliance**: AWS is a PCI DSS Level 1 service provider and publishes its attestations (SOC 1/2, PCI AoC, ISO 27001) in **AWS Artifact**. That covers the infrastructure. **Your** controls — IAM, network segmentation, encryption, logging, vulnerability management, secure SDLC — are what your QSA assesses. Using an in-scope service is necessary but never sufficient.

**PCI DSS: reduce scope before securing it**
- Keep PANs out: hosted payment pages or fields from the PSP, or network tokens. If you never touch a PAN, most of your estate is out of scope.
- If you must store PANs: a dedicated **CDE account**, its own VPC with no route to non-CDE networks except defined endpoints, a tokenisation service with **CloudHSM or KMS** keys, strict SCPs, quarterly scans, file integrity monitoring.
- PCI DSS 4.0.1 emphasises targeted risk analyses, MFA everywhere in the CDE, and protection against script tampering on payment pages.

**SOX (ITGC) change management**
- All production changes through pipelines with peer review and approvals (q30), segregation of duties (developers cannot deploy unreviewed code or change prod directly), break-glass access logged and reviewed.
- Evidence: pull requests, pipeline logs, CloudTrail, and Identity Center access reviews.

**Data residency**
- SCP Region-deny to approved Regions; S3/KMS policies blocking replication outside them; check that "global" services (CloudFront logs, IAM, Route 53) do not store regulated data; avoid copying production data to non-EU support tooling.

**Continuous evidence instead of annual scrambles**
- **AWS Config** conformance packs (PCI DSS, CIS) and **Security Hub** standards continuously evaluate controls.
- **Audit Manager** maps evidence (Config results, CloudTrail, manual uploads) to framework controls.
- Immutable logs in the log-archive account with Object Lock; retention to match regulation (PCI requires at least 12 months of audit logs, 3 months immediately available).
- **Control owners and dashboards**: every control has an owner and an automated check; exceptions are tickets with expiry.`,
  code: r`~~~json
// Config conformance pack excerpt (subset of PCI-aligned rules)
{ "Resources": {
    "S3BucketSSLRequestsOnly":      { "Type": "AWS::Config::ConfigRule", "Properties": { "ConfigRuleName": "s3-bucket-ssl-requests-only", "Source": { "Owner": "AWS", "SourceIdentifier": "S3_BUCKET_SSL_REQUESTS_ONLY" } } },
    "RdsStorageEncrypted":          { "Type": "AWS::Config::ConfigRule", "Properties": { "ConfigRuleName": "rds-storage-encrypted", "Source": { "Owner": "AWS", "SourceIdentifier": "RDS_STORAGE_ENCRYPTED" } } },
    "RestrictedSsh":                { "Type": "AWS::Config::ConfigRule", "Properties": { "ConfigRuleName": "restricted-ssh", "Source": { "Owner": "AWS", "SourceIdentifier": "INCOMING_SSH_DISABLED" } } },
    "CloudTrailEnabled":            { "Type": "AWS::Config::ConfigRule", "Properties": { "ConfigRuleName": "cloudtrail-enabled", "Source": { "Owner": "AWS", "SourceIdentifier": "CLOUD_TRAIL_ENABLED" } } },
    "IamUserMfaEnabled":            { "Type": "AWS::Config::ConfigRule", "Properties": { "ConfigRuleName": "iam-user-mfa-enabled", "Source": { "Owner": "AWS", "SourceIdentifier": "IAM_USER_MFA_ENABLED" } } }
} }
~~~`,
  dia: r`flowchart TB
  subgraph CDE[CDE account - PCI scope]
    TOK[Tokenisation service] --> HSM[CloudHSM / KMS]
  end
  subgraph OUT[Non-CDE accounts - out of scope]
    APP[Payments API - tokens only]
  end
  PSP[PSP hosted fields] -->|PAN never reaches app| TOK
  APP -->|PrivateLink, tokens| TOK
  CFG[Config conformance packs] --> SH[Security Hub]
  SH --> AM[Audit Manager evidence]
  CT[CloudTrail org trail] --> LA[(Log archive - Object Lock)]
  LA --> AM`,
  pts: [r`AWS attests the infrastructure; your controls are what auditors assess.`, r`Reduce PCI scope with hosted fields and tokenisation; isolate any CDE in its own account.`, r`SOX change control via reviewed pipelines and segregation of duties.`, r`Residency through Region-deny SCPs and replication controls.`, r`Continuous evidence: Config, Security Hub, Audit Manager, immutable logs, control owners.`],
  ex: r`Moving checkout to PSP hosted fields shrank a retailer's PCI scope from 60 services to the payment page and one tokenisation adapter, cutting annual assessment effort by roughly two thirds.`,
  fu: [r`What is your evidence that no PAN reaches application logs?`, r`How do you handle a production hotfix under SOX at 2 a.m.?`],
  pit: [r`Claiming compliance because AWS services are PCI compliant.`, r`Letting the CDE share a network with everything else.`, r`Gathering evidence manually once a year.`] },

{ id: 'q42', level: 'Principal', tags: ['cell-based-architecture', 'blast-radius', 'shuffle-sharding'],
  q: r`Explain cell-based architecture on AWS. When is it worth the cost, how do you route to cells, size them, and deploy safely, and how does shuffle sharding reduce blast radius?`,
  a: r`**The idea**: instead of one large deployment serving everyone, run **N identical, independent copies (cells)** of the stack, each serving a subset of customers, with its own compute, database and queues — often its own AWS account. A thin **cell router** maps a customer (tenant, merchant, account range) to a cell.

**Why**: failures, bad deployments, poison requests and noisy tenants are contained to one cell. With 20 cells, a cell-level failure affects about 5% of customers, not 100%. Each cell has a known, tested maximum size, so scaling becomes "add cells" rather than "discover the next bottleneck".

**When worth it**: large multi-tenant platforms with strict availability (payments acceptance, brokerage order entry, SaaS core services). Not worth it for a modest internal system: cells multiply infrastructure, observability, deployment and data-migration complexity.

**Design points**
- **Partition key**: usually tenant or merchant id. Cross-cell operations (global reporting, a customer in two cells) need an aggregation layer — design them in early.
- **Cell router**: must be the most reliable component — minimal logic, a mapping table cached locally (DynamoDB global table or config pushed to the edge), static stability if the mapping store is unavailable.
- **Cell size**: set a maximum that you load-test (for example 5,000 merchants or 500 TPS). Never let a cell grow beyond the tested size.
- **Migration**: moving a tenant between cells is a data migration (copy, sync, cut over, verify) — build tooling for it.
- **Deployments**: deploy cell by cell in **waves** (one canary cell, then 10%, then the rest) with bake times and automatic rollback; a bad release touches one cell first.

**Shuffle sharding**: assign each customer to a **random combination** of k resources out of n (for example 2 of 8 workers). Two customers rarely share the same combination: with 8 workers and pairs, there are 28 combinations, so a poison customer that kills its 2 workers affects only customers sharing both workers. Route 53 and many AWS services use this internally.`,
  code: r`~~~csharp
// Cell router: static mapping cached in memory, refreshed in the background; survives store outages
public sealed class CellRouter(ICellMapStore store, ILogger<CellRouter> log) : BackgroundService
{
    private volatile IReadOnlyDictionary<string, Uri> _map = new Dictionary<string, Uri>();

    public Uri Resolve(string merchantId) =>
        _map.TryGetValue(merchantId, out var cell) ? cell
            : throw new UnknownTenantException(merchantId);  // never route a tenant to a guessed cell

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try { _map = await store.LoadAsync(ct); }               // DynamoDB global table
            catch (Exception ex) { log.LogWarning(ex, "Cell map refresh failed; keeping last known map"); }
            await Task.Delay(TimeSpan.FromSeconds(30), ct);
        }
    }
}
~~~`,
  dia: r`flowchart TB
  C[Merchants] --> RT[Thin cell router - cached map]
  RT -->|merchants A-F| C1[Cell 1 account: API, Aurora, queues]
  RT -->|merchants G-M| C2[Cell 2 account]
  RT -->|merchants N-Z| C3[Cell 3 account]
  MAP[(Cell map - global table)] -.refresh.-> RT
  DEP[Deployment waves] -->|canary| C1
  DEP -->|then| C2
  DEP -->|then| C3`,
  pts: [r`Cells are independent full copies serving subsets of customers.`, r`Blast radius shrinks to one cell; scaling means adding tested cells.`, r`The router must be simple and statically stable.`, r`Cap cell size at a load-tested maximum; build tenant migration tooling.`, r`Deploy in waves; shuffle sharding isolates poison tenants further.`],
  ex: r`A payments SaaS moved to 16 cells; a bad configuration release hit only the canary cell (about 6% of merchants) for 7 minutes before automatic rollback, instead of a platform-wide outage.`,
  fu: [r`How do you run reporting across all cells?`, r`How do you move a large tenant to a new cell without downtime?`],
  pit: [r`Putting business logic in the cell router.`, r`Letting cells grow beyond tested limits.`, r`Deploying to all cells at once.`] },

{ id: 'q43', level: 'Principal', tags: ['platform-strategy', 'serverless', 'containers', 'adr'],
  q: r`Your organisation of 30 teams must standardise compute: serverless-first, ECS, or EKS? Write the decision as an ADR: context, options, criteria, decision and consequences.`,
  a: r`**Context**: 30 .NET teams, mixed workloads (APIs, queue workers, batch, a few long-running stateful services), a 6-person platform team, PCI and SOX obligations, a mandate to reduce operational toil and cost.

**Options and criteria**
| Criterion | Lambda-first | ECS Fargate | EKS |
|---|---|---|---|
| Ops burden | lowest | low | highest (cluster lifecycle, add-ons, upgrades) |
| Fit for steady high load | costly at sustained high utilisation | good | good, best bin-packing |
| Fit for spiky/event work | excellent | good with scaling | good with KEDA |
| Portability / ecosystem | AWS-specific | AWS-specific | Kubernetes-portable, huge ecosystem |
| Developer model | functions, 15-min limit, cold starts | containers, ASP.NET Core unchanged | containers + Kubernetes concepts |
| Skills needed | low | low-medium | high |

**Decision** (typical for this context): **ECS Fargate as the default for services**, **Lambda for event glue and spiky low-volume work** (S3 triggers, schedules, webhooks), **EKS only by exception** when a team needs Kubernetes-specific capabilities (operators, service mesh, portability mandates) and accepts the platform cost. Provide a **golden path**: CDK constructs, pipeline templates, observability and security defaults for each.

**Why not EKS everywhere**: a 6-person platform team running multi-tenant Kubernetes for 30 teams spends its time on upgrades and add-ons rather than developer experience. **Why not Lambda everywhere**: long-running and steady high-throughput services are cheaper and simpler as containers, and cold starts matter for latency-sensitive APIs.

**Consequences**
- Positive: most teams deploy containers with no cluster to manage; predictable cost; one paved road.
- Negative: AWS lock-in (accepted; exit strategy documented: containers are portable, IaC rewrite needed); exceptions need governance.
- Review triggers: platform team grows, regulatory portability demands, or more than 30% of teams request exceptions.

**What interviewers look for**: decision criteria tied to the organisation's constraints (team size, skills, regulation), explicit consequences, and a revisit condition — not a technology preference.`,
  code: r`~~~markdown
# ADR-017: Default compute platform
Status: Accepted (2026-10-11)  Owner: Platform architecture
## Context
30 .NET teams, 6 platform engineers, PCI + SOX, toil and cost reduction mandate.
## Decision
Default: ECS Fargate (Graviton) via the "service" CDK construct.
Event glue / spiky low volume: Lambda via the "function" construct.
EKS: exception only, approved by architecture board, team funds operations.
## Consequences
+ No cluster lifecycle for most teams; one golden path; predictable cost.
- AWS lock-in accepted; exit plan: OCI images + IaC rewrite estimated at 6 months.
## Revisit when
Platform team > 15 people, regulator requires portability, or > 30% of teams request EKS.
~~~`,
  dia: r`flowchart TD
  W[New workload] --> Q1{Event-driven, spiky, short?}
  Q1 -->|yes| L[Lambda golden path]
  Q1 -->|no| Q2{Needs Kubernetes-specific features?}
  Q2 -->|no| E[ECS Fargate golden path - default]
  Q2 -->|yes| AB[Architecture board exception]
  AB -->|approved, team funds ops| K[EKS platform]`,
  pts: [r`Tie the decision to team size, skills, regulation and workload mix.`, r`ECS Fargate default, Lambda for event glue, EKS by exception is common for mid-size .NET estates.`, r`Golden paths make the default the easiest choice.`, r`State consequences, accepted lock-in and an exit plan.`, r`Define revisit triggers.`],
  ex: r`A bank's architecture board adopted this ADR; within a year 24 of 30 teams were on the Fargate golden path and median time to first production deploy for a new service fell from 6 weeks to 4 days.`,
  fu: [r`How would you handle a team that insists on EKS?`, r`What metrics would tell you the decision was wrong?`],
  pit: [r`Choosing by technology fashion.`, r`No exception process, leading to shadow platforms.`, r`Ignoring the platform team's capacity.`] },

{ id: 'q44', level: 'Principal', tags: ['multi-tenancy', 'saas', 'tenant-isolation', 'abac'],
  q: r`Design tenant isolation for a multi-tenant B2B SaaS on AWS (for example a treasury platform for corporate clients): silo, pool and bridge models, enforcing isolation with IAM, noisy-neighbour control, and per-tenant cost.`,
  a: r`**Models**
| Model | What | Pros | Cons |
|---|---|---|---|
| **Silo** | dedicated stack or account per tenant | strongest isolation, per-tenant compliance, simple cost | expensive, operational sprawl, slow onboarding |
| **Pool** | shared infrastructure, tenant id on every row/request | cheapest, simplest operations at scale | isolation is enforced in code; noisy neighbours |
| **Bridge** | mix per tier or per layer | match isolation to tier and risk | more designs to run |

Common answer: **pool for standard tenants, silo for premium/regulated tenants** (a large bank client may contractually require dedicated infrastructure and its own KMS key), with the same code and deployment pipeline for both.

**Enforcing isolation in the pool**: do not rely only on {{WHERE tenant_id = @t}} in application code.
- **Tenant context** from the token (OIDC claim), never from a request parameter.
- **IAM-enforced isolation (ABAC)**: assume a role with **session tags** ({{TenantId=t-42}}); policies restrict DynamoDB {{dynamodb:LeadingKeys}} to that tenant and S3 to prefix {{tenants/t-42/}}. A bug in a query then gets AccessDenied instead of another tenant's data.
- **Relational**: PostgreSQL **row-level security** keyed on a session variable; or schema-per-tenant for mid-tier.
- **Encryption**: per-tenant data keys, or per-tenant KMS keys for silo tenants (enables crypto-shredding on exit).

**Noisy neighbours**: per-tenant rate limits (API Gateway usage plans or a token bucket in Redis), per-tenant queue partitioning or fair scheduling, workload quotas, and moving outliers to their own cell or silo.

**Tenant-aware operations**: metrics, logs and traces tagged by tenant (low-cardinality metrics by tier; tenant id in logs and traces); per-tenant cost attribution via usage metering (requests, storage, compute time) for pricing and margin.

**Onboarding**: automated tenant provisioning (Step Functions) creating identity, data partitions, keys and configuration in minutes — silo tenants via account vending.`,
  code: r`~~~json
// Role assumed with session tag TenantId: can only touch that tenant's items and objects
{ "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:eu-west-1:111122223333:table/positions",
      "Condition": { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["TENANT#$\{aws:PrincipalTag/TenantId}*"] } } },
    { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::treasury-docs/tenants/$\{aws:PrincipalTag/TenantId}/*" } ] }
~~~
~~~csharp
// Per-request scoped credentials: tenant from the validated token, never from the request body
var tenantId = httpContext.User.FindFirstValue("tenant_id")!;
var creds = await sts.AssumeRoleAsync(new AssumeRoleRequest
{
    RoleArn = tenantScopedRoleArn, RoleSessionName = $"t-{tenantId}", DurationSeconds = 900,
    Tags = [ new Tag { Key = "TenantId", Value = tenantId } ]
});
var tenantDynamo = new AmazonDynamoDBClient(creds.Credentials);   // cache per tenant until expiry
~~~`,
  dia: r`flowchart LR
  T1[Tenant A user] -->|JWT tenant_id=A| API[Shared API - pool]
  T2[Tenant B user] -->|JWT tenant_id=B| API
  API -->|AssumeRole + session tag| STS[STS]
  API -->|scoped creds: LeadingKeys TENANT#A| DDB[(Shared DynamoDB)]
  API -->|prefix tenants/A/| S3[(Shared S3)]
  P[Premium bank tenant] --> SILO[Silo account: dedicated stack + own KMS key]`,
  pts: [r`Silo, pool and bridge trade isolation for cost and operability.`, r`Tenant context comes from the token, never the request body.`, r`Enforce pooled isolation with IAM session tags, LeadingKeys and S3 prefixes, or row-level security.`, r`Control noisy neighbours with per-tenant limits and moving outliers to cells or silos.`, r`Tenant-aware observability and metering for cost and pricing.`],
  ex: r`A treasury SaaS added IAM session-tag isolation after a query bug briefly exposed another tenant's positions in a test environment; the same class of bug now fails with AccessDenied.`,
  fu: [r`How do you migrate a tenant from pool to silo?`, r`What does crypto-shredding give you when a tenant leaves?`],
  pit: [r`Tenant id taken from request parameters.`, r`Isolation enforced only by WHERE clauses.`, r`Tenant id as a CloudWatch metric dimension at scale.`] },

{ id: 'q45', level: 'Principal', tags: ['hybrid', 'direct-connect', 'dns', 'mainframe'],
  q: r`Connect AWS to on-premises core banking (mainframe and data centre) reliably: Direct Connect resiliency models, VPN backup, hybrid DNS with Route 53 Resolver, and integration patterns for systems that cannot scale.`,
  a: r`**Network connectivity**
- **Direct Connect (DX)**: dedicated private connection (1, 10, 100 Gbps dedicated, or hosted connections) to a DX location. Consistent latency, lower data-transfer-out pricing, not over the internet.
- **Resiliency models**: *development* (one connection), *high resiliency* (one connection at each of two DX locations), *maximum resiliency* (two connections at each of two locations, on separate devices) — the model AWS recommends for critical workloads and backs with the highest SLA.
- **Site-to-Site VPN** over the internet as a cheaper backup path (BGP failover), or as the primary path for small sites.
- **Encryption**: DX is private but not encrypted by default — use **MACsec** on supported dedicated connections or run IPsec VPN over DX; TLS at the application layer regardless.
- Terminate on a **Direct Connect gateway** attached to Transit Gateway so all Regions and VPCs share the hybrid link.

**Hybrid DNS**: **Route 53 Resolver** inbound endpoints (on-premises resolves AWS private zones) and outbound endpoints with forwarding rules (AWS resolves {{corp.bank.local}} via on-premises DNS), shared across accounts via RAM. DNS is the most common hidden hybrid failure.

**Integration with systems that cannot scale** (a mainframe with a fixed MIPS budget, a core-banking batch window)
- **Never put cloud elasticity directly in front of a fixed-capacity system**: 500 auto-scaled tasks can overwhelm a mainframe gateway built for 50 concurrent sessions.
- Put a **queue and a rate-limited adapter** between them (concurrency cap matched to the mainframe's capacity), with circuit breakers.
- **Read offload**: CDC from the mainframe or core database (vendor CDC tools, DMS for supported sources, Amazon MQ/IBM MQ bridging) into AWS read models, so cloud channels read from AWS and only writes reach the mainframe.
- Respect batch windows: schedule bulk work, buffer during end-of-day.
- Idempotent, reconciled interfaces: mainframe transactions identified by a business reference so retries do not double-post.`,
  code: r`~~~csharp
// Adapter that protects a fixed-capacity mainframe gateway: bounded concurrency + circuit breaker
builder.Services.AddResiliencePipeline("mainframe", p => p
    .AddConcurrencyLimiter(permitLimit: 40, queueLimit: 200)            // gateway supports ~50 sessions
    .AddTimeout(TimeSpan.FromSeconds(5))
    .AddCircuitBreaker(new() { FailureRatio = 0.3, MinimumThroughput = 30, BreakDuration = TimeSpan.FromSeconds(30) }));

public async Task<PostingResult> PostAsync(Posting p, ResiliencePipelineProvider<string> pipelines, CancellationToken ct) =>
    await pipelines.GetPipeline("mainframe").ExecuteAsync(async token =>
        await _gateway.PostTransactionAsync(p with { BusinessRef = p.PaymentId.ToString("N") }, token), ct); // idempotent ref
~~~`,
  dia: r`flowchart LR
  subgraph AWS
    APP[Channel services - auto scaled] --> Q[(SQS buffer)] --> AD[Mainframe adapter - max 40 concurrent]
    RM[(Read models - Aurora)]
    R53[Route 53 Resolver endpoints]
    TGW((Transit Gateway))
  end
  AD --> TGW
  TGW --> DXG[DX gateway]
  DXG -->|DX loc 1: 2 links| DC[On-prem data centre]
  DXG -->|DX loc 2: 2 links| DC
  TGW -.VPN backup.-> DC
  DC --> MF[Mainframe core banking]
  MF -->|CDC| RM
  R53 <-->|DNS forwarding| DNS[Corporate DNS]`,
  pts: [r`Maximum resiliency DX: two locations, two connections each; VPN as backup.`, r`Encrypt with MACsec or IPsec over DX; DX alone is not encrypted.`, r`Route 53 Resolver inbound/outbound endpoints for hybrid DNS.`, r`Queue and concurrency-capped adapters protect fixed-capacity systems.`, r`CDC read offload so only writes reach the mainframe; idempotent business references.`],
  ex: r`A retail bank's mobile app auto-scaled during a salary-day spike and saturated the mainframe gateway; a queue plus a 40-session adapter and CDC read models removed mainframe-related incidents.`,
  fu: [r`How do you test DX failover without an outage?`, r`What breaks if Route 53 Resolver forwarding rules are not shared to all accounts?`],
  pit: [r`A single DX connection for critical traffic.`, r`Assuming DX is encrypted.`, r`Auto-scaled callers hitting a fixed-capacity backend directly.`] },

{ id: 'q46', level: 'Principal', tags: ['architecture-review', 'anti-patterns', 'well-architected'],
  q: r`Review this architecture: a single EC2 instance in a public subnet runs the .NET API and a cron job, connects to a single-AZ RDS instance with credentials in appsettings.json, uses an IAM user's access keys to read S3, logs to local disk, and is deployed by RDP-ing in and copying files. Prioritise the problems and give a remediation plan.`,
  a: r`Use the **Well-Architected pillars** to structure the review, then prioritise by **risk × likelihood**, not by pillar order.

**Critical (fix this week)**
1. **Security — static IAM user keys and plaintext DB credentials**: anyone with the file or the box has long-lived access. → Instance role (later task role); secrets in Secrets Manager with rotation; rotate and delete the keys now; check CloudTrail for misuse.
2. **Security — public subnet, RDP**: internet-exposed instance with an admin protocol. → Move to private subnets behind an ALB; remove RDP; use **SSM Session Manager** for access (no inbound ports, audited sessions).
3. **Reliability — single instance, single-AZ RDS**: any instance or AZ failure is an outage, and data loss is possible. → RDS Multi-AZ (or Aurora); automated backups with PITR and a tested restore; at least two app instances across AZs behind the ALB.

**High (this month)**
4. **Operational excellence — manual deployments**: no audit trail, no rollback, SOX finding. → Containerise, CI/CD with reviewed pipelines and immutable images (q30).
5. **Observability — local logs**: lost when the instance dies; no alerting. → Structured logs to CloudWatch, metrics, traces, SLO alarms (q18).
6. **Coupled cron job**: runs on the API box, so scaling to two instances runs it twice. → EventBridge Scheduler → ECS task or Lambda, idempotent, with a lock if needed.

**Medium (this quarter)**
7. **Performance/cost**: rightsizing, Savings Plans after stabilising, S3 via a gateway endpoint.
8. **IaC**: everything in CDK/Terraform so environments are reproducible.

**How to present it**: a one-page risk register (finding, impact, likelihood, owner, date), quick wins first, and a target architecture diagram. Acknowledge what works (it delivers business value today) and sequence changes so each step is independently safe.`,
  code: r`~~~text
Finding                         Pillar        Risk      Fix                                   Owner   Due
Static IAM user keys            Security      Critical  Instance/task role, delete keys        Team A  +3d
DB password in appsettings      Security      Critical  Secrets Manager + rotation             Team A  +5d
Public EC2 with RDP             Security      Critical  Private subnet, ALB, Session Manager   Platform +7d
Single EC2 / single-AZ RDS      Reliability   Critical  2+ tasks across AZs, RDS Multi-AZ      Team A  +14d
Manual RDP deployments          Ops / SOX     High      CI/CD pipeline, immutable images       Team A  +30d
Local-disk logs, no alarms      Ops           High      CloudWatch logs, SLO alarms            Team A  +30d
Cron on the API host            Reliability   High      EventBridge Scheduler -> ECS task      Team A  +30d
No IaC                          Ops           Medium    CDK stacks                             Team A  +90d
~~~`,
  dia: r`flowchart LR
  subgraph Before
    I[Internet] --> EC2[Single EC2 - public, RDP, API + cron, local logs]
    EC2 --> RDS1[(RDS single-AZ)]
    EC2 -->|IAM user keys| S3a[(S3)]
  end
  subgraph After
    I2[Internet] --> ALB[ALB + WAF]
    ALB --> T1[ECS task AZ a]
    ALB --> T2[ECS task AZ b]
    T1 --> RDS2[(RDS Multi-AZ - Secrets Manager creds)]
    T2 --> RDS2
    SCH[EventBridge Scheduler] --> JOB[ECS job task]
    T1 -->|task role, gateway endpoint| S3b[(S3)]
  end`,
  pts: [r`Structure by Well-Architected pillars; prioritise by risk and likelihood.`, r`Credentials and exposure first: roles, Secrets Manager, private subnets, Session Manager.`, r`Then reliability: multiple AZs, Multi-AZ database, tested restores.`, r`Then delivery and operations: CI/CD, observability, separate scheduled jobs.`, r`Present a risk register and a safe, incremental sequence.`],
  ex: r`A review of a fintech's back-office service found exactly this pattern; rotating the leaked-prone keys on day one mattered — CloudTrail showed the keys had been used from an unknown IP two weeks earlier.`,
  fu: [r`What would you do in the first hour if you suspected the keys were already leaked?`, r`How do you get the team to own the plan rather than feel judged?`],
  pit: [r`Leading with cost or refactoring while credentials are exposed.`, r`A list of 40 findings with no priorities.`, r`Recommending a full rewrite.`] },

{ id: 'q47', level: 'Principal', tags: ['regional-outage', 'control-plane', 'dependencies'],
  q: r`A major AWS Region has a multi-hour impairment of a core service, and your "multi-AZ" platform still went down. Using that kind of event, explain control-plane versus data-plane dependencies, hidden global dependencies, and how you design for regional service impairment.`,
  a: r`**Why multi-AZ was not enough**: AZ redundancy protects against an AZ failure, not a **Regional service impairment** (for example a regional DynamoDB, IAM/STS, Lambda or networking control-plane problem). If every AZ depends on the same regional service, all fail together.

**Control plane vs data plane**
- **Control plane**: create/modify/delete APIs (launch instances, create functions, change DNS records, update scaling).
- **Data plane**: the running resource doing its job (an instance serving traffic, a DynamoDB GetItem, Route 53 answering queries).
- Data planes are designed for higher availability. During impairments, control planes often degrade first: **auto scaling cannot launch, deployments fail, new Lambda environments cannot start**. Systems that need the control plane to recover (scale out, replace instances, rotate DNS) are not statically stable.

**Hidden dependencies to inventory**
- Services homed in **us-east-1** for their control plane (IAM, Route 53 record changes, CloudFront configuration, some billing/organizations APIs). Avoid needing to change them during an incident; pre-provision.
- STS endpoints: use **regional STS endpoints**, not the legacy global one.
- Third-party SaaS (identity provider, feature flags, observability, CI) that runs in the same Region.
- Your own shared services (auth, config, secrets) running in one Region.
- Cold start dependence: tasks that must fetch secrets/config at start-up cannot start if that service is impaired — cache and fail static.

**Designing for regional impairment**
1. Know each capability's **criticality and RTO**; not everything needs multi-Region.
2. For critical paths: warm standby or active-active in a second Region (q37), with **data-plane failover** (ARC routing controls, pre-created health checks).
3. Pre-scale: during an impairment you may not be able to add capacity.
4. Degrade gracefully: serve cached reads, queue writes, disable non-essential features with flags evaluated locally.
5. Practise the failover decision with **regional game days**, including "failover while IAM changes are not possible".
6. Communications: status page and customer messaging pre-agreed.`,
  code: r`~~~csharp
// Use regional STS endpoints and fail static on config: keep serving with the last known good values
AWSConfigs.AWSRegion = "eu-west-1";
Environment.SetEnvironmentVariable("AWS_STS_REGIONAL_ENDPOINTS", "regional");

public sealed class FeatureFlags(IAppConfigClient client, ILogger<FeatureFlags> log)
{
    private FlagSet _lastGood = FlagSet.SafeDefaults;          // shipped in the image
    public async Task<FlagSet> GetAsync(CancellationToken ct)
    {
        try { return _lastGood = await client.FetchAsync(ct); }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Config unavailable; using last known good flags");
            return _lastGood;                                   // never fail requests because config is down
        }
    }
}
~~~`,
  dia: r`flowchart TB
  subgraph Region1[eu-west-1 - impaired regional service]
    A1[AZ a] --> RS[Regional service - impaired]
    A2[AZ b] --> RS
    A3[AZ c] --> RS
  end
  subgraph Region2[eu-central-1 - warm standby, pre-scaled]
    B1[Full stack]
  end
  ARC[ARC routing controls - data plane] -->|shift| B1
  CP[Control plane APIs: scale, deploy, DNS edits] -.unavailable during event.-> Region1`,
  pts: [r`Multi-AZ does not protect against regional service impairment.`, r`Control planes degrade first; design recovery to use data planes only.`, r`Inventory hidden dependencies: us-east-1 control planes, global STS, SaaS, shared services.`, r`Pre-scale, cache, fail static, degrade gracefully.`, r`Multi-Region only for capabilities whose RTO demands it; practise the failover.`],
  ex: r`During a regional impairment, a broker's services stayed up but could not scale for market open; afterwards they raised baseline capacity before the open and moved order entry to warm standby with ARC routing controls.`,
  fu: [r`Which of your dependencies would fail if us-east-1 control planes were down?`, r`How do you decide which capabilities deserve multi-Region?`],
  pit: [r`Assuming multi-AZ equals highly available against everything.`, r`Recovery runbooks that create resources or edit DNS during the event.`, r`Ignoring third-party dependencies in the same Region.`] },

{ id: 'q48', level: 'Principal', tags: ['platform-engineering', 'governance', 'golden-paths', 'policy-as-code'],
  q: r`As Principal Engineer you own AWS governance for 300 engineers. How do you balance autonomy and control: golden paths, guardrails, policy as code, exceptions, and measuring whether governance helps or hurts delivery?`,
  a: r`**Principle: make the right thing the easy thing.** Governance that relies on review boards and documents slows delivery and still misses things; governance built into tooling scales.

**Three layers**
1. **Preventive guardrails** (cannot do the dangerous thing): SCPs/RCPs (no unapproved Regions, no disabling CloudTrail, no public S3 at account level, IMDSv2 required), permission boundaries for team-created roles.
2. **Paved road / golden paths** (easy to do the right thing): CDK constructs or Terraform modules for "service", "queue worker", "function", "database" with security, observability, tagging and backups built in; pipeline templates; service catalogue (Backstage) with scaffolding.
3. **Detective controls** (find drift and exceptions): Config rules, Security Hub, policy-as-code in CI (cfn-guard, Checkov, OPA), cost anomaly alerts — routed to the owning team with SLAs, not to a central queue.

**Exceptions**: a lightweight, time-bound process — an ADR, a risk owner, compensating controls, an expiry date. Track exception counts: many exceptions to the same rule means the rule or the golden path is wrong.

**Team autonomy**: teams own their accounts and services ("you build it, you run it") inside the guardrails. Central teams provide platforms as products, with roadmaps based on developer feedback.

**Measure it**
- Delivery: DORA metrics (deployment frequency, lead time, change failure rate, time to restore) — governance should not worsen them.
- Safety: critical findings open, mean time to remediate, percentage of workloads on golden paths, exceptions outstanding.
- Developer experience: time to first production deploy for a new service, survey scores.

**Common failure**: a central architecture board approving every design. Replace with published standards, golden paths, and reviews only for high-risk changes (new data stores for regulated data, cross-account trust, internet exposure).`,
  code: r`~~~csharp
// Golden-path construct: teams get secure defaults by using it, not by reading a wiki
public class PaymentsService : Construct
{
    public PaymentsService(Construct scope, string id, PaymentsServiceProps p) : base(scope, id)
    {
        var svc = new ApplicationLoadBalancedFargateService(this, "Svc", new ApplicationLoadBalancedFargateServiceProps
        {
            Cluster = p.Cluster, PublicLoadBalancer = p.InternetFacing, DesiredCount = Math.Max(3, p.MinTasks),
            RuntimePlatform = new RuntimePlatform { CpuArchitecture = CpuArchitecture.ARM64 },
            CircuitBreaker = new DeploymentCircuitBreaker { Rollback = true },
            TaskImageOptions = new ApplicationLoadBalancedTaskImageOptions
            {
                Image = ContainerImage.FromEcrRepository(p.Repo, p.ImageDigest),
                LogDriver = LogDrivers.AwsLogs(new AwsLogDriverProps { StreamPrefix = id, LogRetention = RetentionDays.ONE_YEAR })
            }
        });
        Tags.Of(this).Add("service", id); Tags.Of(this).Add("owner", p.OwnerTeam); Tags.Of(this).Add("cost-center", p.CostCenter);
        if (p.InternetFacing) new CfnWebACLAssociation(this, "Waf", new CfnWebACLAssociationProps { ResourceArn = svc.LoadBalancer.LoadBalancerArn, WebAclArn = p.StandardWafArn });
    }
}
~~~`,
  dia: r`flowchart LR
  PG[Preventive: SCPs, RCPs, permission boundaries] --> TEAM[Team accounts - autonomy inside guardrails]
  GP[Golden paths: constructs, pipelines, Backstage] --> TEAM
  TEAM --> DET[Detective: Config, Security Hub, policy-as-code in CI]
  DET -->|findings with SLA| TEAM
  TEAM --> EX[Time-bound exceptions with ADR]
  EX -->|frequent exceptions| GP
  M[DORA + safety + DX metrics] --> GP`,
  pts: [r`Make the right thing easy: governance in tooling, not documents.`, r`Preventive guardrails, golden paths, detective controls.`, r`Time-bound exceptions; frequent exceptions signal a bad rule.`, r`Teams own their services inside guardrails.`, r`Measure DORA, safety and developer experience to prove governance helps.`],
  ex: r`Replacing a weekly architecture board with golden-path constructs and policy-as-code cut new-service lead time from 6 weeks to 5 days while critical Security Hub findings fell by 70%.`,
  fu: [r`How do you migrate existing services onto golden paths?`, r`Which decisions still need human architecture review?`],
  pit: [r`Central approval for every change.`, r`Guardrails with no paved road, so teams work around them.`, r`Not measuring the cost of governance on delivery.`] },

{ id: 'q49', level: 'Principal', tags: ['multi-cloud', 'dora-regulation', 'concentration-risk', 'exit-strategy'],
  q: r`The board asks whether the bank should go multi-cloud (AWS + Azure) because of regulator concerns about concentration risk under DORA. How do you answer, and what would you actually implement?`,
  a: r`**Clarify the real requirement.** The EU **Digital Operational Resilience Act** (applying since January 2025) requires ICT third-party risk management, including **exit strategies** and assessment of **concentration risk** for critical functions. It does **not** require running every workload active-active on two clouds. Other regulators (PRA, EBA guidelines, OCC) have similar themes: credible, tested exit and continuity plans.

**Options with honest costs**
| Option | Resilience gain | Cost and complexity |
|---|---|---|
| Single cloud, multi-Region, tested exit plan | strong against regional failure; exit is documented and costed | lowest |
| Workload-level multi-cloud (different systems on different clouds) | diversification at portfolio level | moderate; two skill sets and platforms |
| Critical function portable to a second cloud (warm or cold) | survives provider-level failure for that function | high; lowest-common-denominator design |
| Everything active-active across clouds | theoretical maximum | very high; complexity often reduces reliability |

**Recommended answer**: primary cloud with **multi-Region resilience** for critical functions; a **documented, tested exit plan** (data export formats, IaC rebuild estimates, contractual terms, skills); and **portability by design where cheap** — containers, Kubernetes or standard runtimes, PostgreSQL rather than proprietary databases for the core ledger, OpenTelemetry, Terraform. For one or two truly critical functions, a **stressed exit test** or a cold standby on a second provider may be justified by the regulator's expectations.

**Why not full multi-cloud**: the most common causes of outages are your own changes and configuration, not provider-wide failure. Doubling platforms halves the depth of expertise, adds integration surface, and pushes designs to the lowest common denominator (losing managed services that improve reliability). Data gravity and egress costs make active-active expensive.

**What the board needs**: the risk in business terms, the regulatory requirement, the cost of each option, and a recommendation with what residual risk is accepted — plus evidence that the exit plan is tested, not just written.`,
  code: r`~~~text
Exit-plan register (excerpt, per critical function)
Function            Data export              Rebuild path                       Est. time   Last tested
Card authorisation  Aurora PG -> pg_dump/CDC  Containers + Terraform to Azure AKS 8-12 weeks  2026-06 (tabletop + partial)
Payments ledger     PostgreSQL logical repl.  Same schema on Azure PostgreSQL    6-8 weeks   2026-03 (data restore test)
Customer comms      SQS/SNS -> abstraction    Swap adapters to Service Bus       4 weeks     2025-11
Contracts: termination assistance clause, data return format, 12-month transition period.
~~~`,
  dia: r`flowchart LR
  REQ[DORA: exit strategy + concentration risk] --> A[Multi-Region on primary cloud]
  REQ --> B[Tested exit plan per critical function]
  REQ --> C[Portability where cheap: containers, PostgreSQL, OTel, Terraform]
  B --> D{Function truly critical and regulator expects more?}
  D -->|yes| E[Cold or warm standby on second provider]
  D -->|no| F[Documented, costed, rehearsed exit]`,
  pts: [r`DORA requires exit strategies and concentration-risk management, not universal multi-cloud.`, r`Multi-Region resilience plus a tested exit plan is the usual proportionate answer.`, r`Design for portability where it is cheap; reserve second-cloud standby for the most critical functions.`, r`Full multi-cloud adds complexity that often reduces reliability.`, r`Give the board risk, cost, recommendation and accepted residual risk.`],
  ex: r`A European bank answered its supervisor with multi-Region AWS for payments, a rehearsed data-export and rebuild test of the ledger on a second provider, and contractual exit terms; the supervisor accepted it without requiring active-active.`,
  fu: [r`How would you run a credible exit test without migrating production?`, r`Which AWS services would you avoid for the core ledger to keep portability?`],
  pit: [r`Treating multi-cloud as automatically more resilient.`, r`Exit plans that were never tested.`, r`Designing everything to the lowest common denominator.`] },

{ id: 'q50', level: 'Principal', tags: ['principles', 'summary'],
  q: r`Summarise the AWS architecture principles you would enforce as Principal Engineer for a financial-services platform.`,
  a: r`"My AWS principles fit on one page:

- **Accounts are boundaries**: account per workload and environment, landing zone with SCPs/RCPs, CDE isolated, management account empty.
- **No long-lived credentials**: roles everywhere (task roles, Pod Identity, OIDC for CI, Identity Center for humans); secrets in Secrets Manager; KMS envelope encryption.
- **Private by default**: private subnets, VPC endpoints, centralised egress with allow lists, WAF at the edge, data perimeter policies.
- **Design for failure**: three AZs with static stability, data-plane failover, multi-Region where RTO demands it, tested backups in a locked vault, game days.
- **Correctness over cleverness for money**: relational ledger, idempotency keys, outbox, at-least-once with idempotent consumers, reconciliation as the final detector.
- **Managed services first**, with a reason to run your own.
- **Everything as code**: IaC as the only writer, golden paths, policy as code, immutable images promoted by digest.
- **Observable and auditable**: OpenTelemetry traces, SLO alerts, CloudTrail and Config in a log archive with Object Lock, continuous compliance evidence.
- **Cost is a requirement**: tags, unit economics, Savings Plans on proven baselines, Graviton, NAT and logging hygiene.
- **Exit-aware**: portability where cheap, a tested exit plan for critical functions."`,
  code: r`~~~text
Accounts      : landing zone, SCP/RCP, CDE account, Identity Center
Identity      : roles only, OIDC CI, Pod Identity / task roles, Secrets Manager, KMS
Network       : private subnets, endpoints, TGW + inspection egress, WAF, data perimeter
Resilience    : 3 AZs static stability, ARC, warm standby for critical paths, Backup Vault Lock
Correctness   : Aurora ledger, Idempotency-Key, outbox, idempotent consumers, reconciliation
Delivery      : CDK/Terraform, golden paths, policy as code, build once promote by digest
Operations    : OTel + ADOT, SLO burn alerts, CloudTrail/Config log archive, Audit Manager
Cost          : tags + CUR unit cost, Savings Plans, Graviton, endpoints, log retention
Exit          : containers, PostgreSQL, Terraform, tested exit plan per critical function
~~~`,
  pts: [r`Accounts as boundaries and no long-lived credentials.`, r`Private by default with a data perimeter.`, r`Design for AZ and Region failure with static stability and tested recovery.`, r`Correctness patterns for money: ledger, idempotency, outbox, reconciliation.`, r`Everything as code, observable, auditable, cost-aware and exit-aware.`],
  ex: r`Publishing these principles with golden-path constructs that implement them turned a 40-page cloud standard nobody read into defaults that 90% of new services inherited automatically.`,
  fu: [r`Which principle would you enforce first in a legacy AWS estate?`],
  pit: [r`Principles with no tooling to enforce them.`] }
],
cheat: r`### Request journey
Route 53 → CloudFront (WAF, Shield, OAC) → ALB/API Gateway (public subnets) → ECS/EKS/Lambda (private subnets, task role) → RDS Proxy → Aurora · ElastiCache · SQS/EventBridge via VPC endpoints · NAT only for real internet.

### Networking
Public subnet = route to IGW · SG stateful allow-only, NACL stateless · Gateway endpoints (S3, DynamoDB) free · Interface endpoints per AZ-hour + GB · TGW hub with segmented route tables · PrivateLink for single services · centralised egress + Network Firewall · DX maximum resiliency = 2 locations × 2 links, encrypt with MACsec/IPsec.

### Identity & security
Roles, never keys: task role vs execution role, Pod Identity/IRSA, OIDC for CI, Identity Center for humans · Explicit deny > allow; SCPs/RCPs cap, never grant · KMS envelope encryption + data-key caching · Secrets Manager rotation · GuardDuty + Security Hub + Config org-wide · revoke sessions by aws:TokenIssueTime.

### Compute
| Choice | When |
|---|---|
| Lambda | event glue, spiky, short (15 min); AOT/SnapStart for cold starts |
| ECS Fargate | default for .NET services; circuit breaker + blue/green |
| EKS | Kubernetes features needed; plan IPs, Karpenter, upgrades |
| EC2 | special hardware, licensing, legacy |

### Data
Aurora: storage 6 copies/3 AZs, failover ~30 s, use RDS Proxy · DynamoDB: conditional writes for idempotency, transactions ≤100 items, global tables LWW · ElastiCache: cache-aside, jitter, singleton multiplexer · S3: 3,500 writes / 5,500 reads per prefix, Object Lock compliance for WORM.

### Messaging
SQS: visibility timeout ≥ 6× processing, DLQ, idempotent consumers, FIFO groups · SNS/EventBridge fan-out to queue per consumer, DLQs on targets · Kinesis shard 1 MB/s or 1,000 rec/s in · Step Functions Standard for sagas, task tokens for callbacks.

### Resilience & DR
Static stability: provision peak × n/(n−1) · ARC zonal shift · DR ladder: backup/restore → pilot light → warm standby → active-active · Aurora Global, CRR + RTC · data-plane failover, human decision for ledger promotion · FIS game days.

### Cost
Tags + CUR + unit cost · rightsizing, gp3, idle cleanup, non-prod schedules · Savings Plans on proven baseline · Graviton, Spot · endpoints to cut NAT · log retention.

### Say this
"Accounts are the blast-radius boundary." "Roles, never keys." "Static stability: survive without the control plane." "Exactly-once = at-least-once + idempotency." "Reconciliation is the final detector." "Tested exit plan, not reflexive multi-cloud."`
});
})(String.raw);
