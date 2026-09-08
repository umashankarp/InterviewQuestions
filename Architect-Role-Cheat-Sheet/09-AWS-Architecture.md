# 9. AWS Architecture — 46 Questions (Answered)

> **Method:** every definition is taken from the **official AWS documentation** — the *Global Infrastructure* pages, *Amazon VPC User Guide*, *IAM User Guide*, the *Well-Architected Framework*, *AWS Prescriptive Guidance* and the individual service developer guides — then extended with the architect-level trade-off, the cost consequence and the failure mode. Links in **References**.

---

## Q1. Explain AWS global infrastructure.

**Per AWS:** *"The AWS Cloud infrastructure is built around AWS Regions and Availability Zones. An AWS Region is a physical location in the world where we have multiple Availability Zones. Availability Zones consist of one or more discrete data centers, each with redundant power, networking, and connectivity, housed in separate facilities."*

**The hierarchy, largest to smallest:**

| Level | What it is | Failure isolation | Latency between |
|---|---|---|---|
| **Partition** | `aws`, `aws-us-gov`, `aws-cn` — separate IAM/ARN namespaces | Total | N/A — no implicit connectivity |
| **Region** | A geographic area (e.g. `eu-west-1`) with 3+ AZs | Regions are independent by design | 10s–100s of ms |
| **Availability Zone** | One or more discrete data centres, independent power/cooling/network | Designed to fail independently | **Single-digit ms**, redundant metro fibre |
| **Data centre** | Physical building inside an AZ | Not exposed to you | — |
| **Local Zone / Wavelength / Outpost** | Compute pushed to a metro, a telco 5G network, or your own DC | Extension of a parent Region | ~single-digit ms |
| **Edge location** (CloudFront, Global Accelerator, Route 53) | 600+ PoPs for caching, TLS termination, DNS, anycast ingress | Not a compute tier | ~10 ms to end user |

**Facts an architect is expected to know:**

- **AZ names are randomised per account.** `us-east-1a` in your account is a *different* physical AZ from `us-east-1a` in mine. When placement must be correlated across accounts (shared VPC, cross-account subnet alignment, latency-sensitive co-location), use the **AZ ID** (`use1-az1`), not the AZ name.
- **Regions are not connected by default.** Cross-Region traffic traverses the AWS backbone but must be explicitly configured (VPC peering, TGW peering, service-level replication) and is **charged**.
- **Services are global, regional or zonal.** IAM, Route 53, CloudFront, Organizations, WAF (global scope) are **global**; EC2, RDS, SQS, Lambda, EKS are **regional**; an EC2 instance, an EBS volume, a NAT Gateway and a subnet are **zonal**. This classification is exactly what drives blast-radius analysis — you cannot reason about failure domains without it.
- **Data residency is a Region property.** For a workload under GDPR, DORA, MAS TRM or an in-country residency rule, Region choice is a compliance decision taken *before* any architecture decision. AWS does not move data out of a Region unless you configure it to.

**Region selection criteria, in the order I actually apply them:** (1) data residency and regulatory approval, (2) latency to the user population, (3) service and instance-family availability — not everything ships everywhere, (4) cost — per-Region pricing differs by 10–40 %, (5) AZ count (prefer 3+).

---

## Q2. Region vs Availability Zone?

| | **Region** | **Availability Zone** |
|---|---|---|
| **Definition (AWS)** | *"A physical location in the world where we have multiple Availability Zones"* | *"One or more discrete data centers with redundant power, networking, and connectivity in an AWS Region"* |
| **Isolation goal** | Geographic / jurisdictional / disaster isolation | Fault isolation — power, cooling, flood, fire, local network |
| **Separation** | Hundreds to thousands of km | Meaningfully separated, within a metro |
| **Latency between** | 10s–100s of ms | **Typically < 2 ms** |
| **Data transfer cost** | Charged (inter-Region) | **Charged** (cross-AZ, ~$0.01/GB each direction) |
| **Synchronous replication feasible?** | Generally **no** | **Yes** — this is what RDS Multi-AZ does |
| **Solves** | Disaster recovery, data residency, global latency | **High availability** — the default unit of redundancy |

**The distinction that matters in an interview:** *Multi-AZ is a high-availability strategy; multi-Region is a disaster-recovery strategy.* They solve different problems at very different prices. A three-AZ deployment inside one Region survives a data-centre fire, a power failure and most network partitions, automatically and with no data loss. It does **not** survive a Region-wide control-plane event, a bad global configuration push, or a jurisdictional event — that is what multi-Region buys, at roughly 1.7–2× infrastructure cost plus real operational complexity (you now own data conflict resolution, failover runbooks and drift between two live estates).

**Design rule:** *always* multi-AZ — the Well-Architected Reliability pillar effectively assumes it and the marginal effort is small. Go multi-Region only when a stated RTO/RPO or a regulator demands it, and say so explicitly rather than defaulting to it.

---

## Q3. What is a VPC?

**Per the Amazon VPC User Guide:** *"Amazon Virtual Private Cloud (Amazon VPC) enables you to launch AWS resources into a virtual network that you've defined. This virtual network closely resembles a traditional network that you'd operate in your own data center, with the benefits of using the scalable infrastructure of AWS."*

**What it actually is:** a **logically isolated, software-defined network** scoped to **one Region**, spanning **all AZs in that Region**, defined by one or more **CIDR blocks** — the boundary inside which you control IP addressing, routing and network-level access.

| Component | Role |
|---|---|
| **CIDR block** | Private IPv4 range (`/16`–`/28`); primary CIDR is **immutable**, secondary CIDRs can be added |
| **Subnets** | Zonal slices of the CIDR — a subnet lives in exactly one AZ |
| **Route tables** | Per-subnet (or per-gateway) routing decisions |
| **Internet Gateway / egress-only IGW** | Redundant, horizontally scaled internet entry/exit |
| **NAT Gateway** | Outbound-only internet access for private subnets |
| **Security Groups** | Stateful firewall at the ENI |
| **Network ACLs** | Stateless firewall at the subnet |
| **VPC endpoints** (Gateway / Interface) | Private access to AWS services without traversing the internet |
| **Peering / Transit Gateway / VPN / Direct Connect** | Connectivity to other VPCs and on-premises |
| **ENIs** | The network interface every resource actually attaches to |
| **Flow Logs** | Packet-metadata logging to CloudWatch Logs, S3 or Firehose |

**Decisions you make once and live with:**

- **CIDR sizing and allocation.** The primary CIDR cannot be changed. Undersize it and you re-architect later; allocate from a **central IPAM plan** (AWS IPAM, or a spreadsheet with discipline) so VPCs never overlap — overlap is what makes future peering impossible (Q13). A `/16` per VPC with `/20`–`/24` subnets is a common enterprise default.
- **The default VPC.** Every Region ships one with public subnets and an IGW. **Delete it or fence it off in production** — it exists for convenience, not for a regulated workload. "No resources in the default VPC" is a standard AWS Config rule in banks.
- **VPCs are free; what attaches to them is not.** NAT Gateways, interface endpoints, TGW attachments and cross-AZ traffic are the real line items.

---

## Q4. What is a subnet?

**Per AWS:** *"A subnet is a range of IP addresses in your VPC. A subnet must reside in a single Availability Zone."*

**Three things a subnet determines:**

1. **Which AZ** the resource lives in — subnets are how you place workloads for HA.
2. **Which route table** applies — and therefore whether it is public, private or isolated.
3. **Which NACL** applies — the stateless, subnet-wide filter.

**AWS reserves 5 addresses in every subnet.** For `10.0.0.0/24`:

| Address | Reserved for |
|---|---|
| `10.0.0.0` | Network address |
| `10.0.0.1` | VPC router |
| `10.0.0.2` | Amazon-provided **DNS** (VPC base + 2) |
| `10.0.0.3` | Reserved for future use |
| `10.0.0.255` | Broadcast (unsupported, still reserved) |

So a `/24` yields **251 usable addresses**, not 256. This matters more than it sounds: the **EKS VPC CNI assigns a VPC IP per pod**, so pod density is bounded by subnet size. A `/24` node subnet exhausts quickly and produces `failed to assign an IP address to container` — which looks like a Kubernetes problem and is actually a subnet-sizing problem. (Mitigations: larger subnets, secondary CIDRs with custom networking, or prefix delegation.)

**Standard three-tier layout, per AZ:**

```
AZ-a                       AZ-b                       AZ-c
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│ Public /24       │ ALB   │ Public /24       │       │ Public /24       │
│                  │ NAT   │                  │       │                  │
├──────────────────┤       ├──────────────────┤       ├──────────────────┤
│ Private App /20  │ EKS   │ Private App /20  │       │ Private App /20  │
├──────────────────┤       ├──────────────────┤       ├──────────────────┤
│ Isolated DB /24  │ RDS   │ Isolated DB /24  │       │ Isolated DB /24  │
└──────────────────┘       └──────────────────┘       └──────────────────┘
```

The DB tier has **no `0.0.0.0/0` route at all** — not even to NAT. That is the difference between "private" and "isolated", and in a card-processing environment the isolated tier is where PCI-scoped data lives.

---

## Q5. Public vs private subnet?

**AWS's definition is purely about routing:** *"If a subnet is associated with a route table that has a route to an internet gateway, it's known as a public subnet."* There is no attribute called "public" — **it is entirely a property of the route table.**

| | **Public** | **Private** | **Isolated** |
|---|---|---|---|
| `0.0.0.0/0` route | → **Internet Gateway** | → **NAT Gateway** | **none** |
| Inbound from internet | Possible (SG/NACL permitting **and** a public IP present) | Impossible | Impossible |
| Outbound to internet | Yes, direct | Yes, source-NATed | No |
| Needs a public IP? | **Yes** — an IGW route without a public/Elastic IP does nothing | No | No |
| Typical contents | ALB/NLB, NAT Gateway | App servers, ECS tasks, EKS nodes, Lambda-in-VPC | RDS, Aurora, ElastiCache |

**Two facts that separate a real answer from a hand-wave:**

1. **A public subnet without a public IP is unreachable.** The IGW performs 1:1 NAT between the private address and the public/Elastic IP. No public IP → nothing to translate → no inbound *and* no outbound. This is the most common "my instance is in a public subnet but can't reach the internet" root cause.
2. **Private + NAT is outbound-only by construction.** NAT Gateway maps many private sources to one public IP with no inbound port mapping, so unsolicited inbound is *structurally* impossible rather than merely blocked by a rule. That structural property is what makes it defensible to an auditor.

**What I actually place in a public subnet in production:** load balancers and NAT Gateways. Nothing else. Application compute goes in private subnets, databases in isolated subnets, and administrative access is via **SSM Session Manager** — no bastion with an open port 22, no inbound SSH rule to justify at audit.

---

## Q6. What is a route table?

**Per AWS:** *"A route table contains a set of rules, called routes, that are used to determine where network traffic from your subnet or gateway is directed."*

**Mechanics:**

- Every VPC has a **main route table**. Every subnet is associated with exactly **one** route table (the main one implicitly, if you don't associate another). One route table can serve many subnets.
- Every route table has an **un-deletable `local` route** for the VPC CIDR. This is why everything in a VPC can reach everything else at the routing layer regardless of subnet — and therefore why **isolation inside a VPC is enforced with security groups, not routing**.
- Routing is **longest-prefix match**: `10.0.5.0/24 → tgw` beats `10.0.0.0/8 → pcx` beats `0.0.0.0/0 → nat`.
- Targets: `local`, Internet Gateway, egress-only IGW, NAT Gateway, Transit Gateway, peering connection, Virtual Private Gateway, Gateway Endpoint (via managed prefix list), Network Firewall endpoint, or a specific ENI.

**Gateway route tables** are worth naming as depth: a route table can be associated with the **IGW or VGW itself**, forcing ingress traffic through an inspection appliance (AWS Network Firewall, a third-party IDS) before it reaches the subnet — mandatory ingress inspection without touching application routing.

**The recurring failure:** someone adds a subnet for a new AZ and forgets to associate a route table, so it silently inherits **main**. If main carries an IGW route, you have just created an accidental public subnet — possibly containing a database. Mitigation: keep the **main route table empty except for `local`**, always associate explicitly, and enforce both with AWS Config.

---

## Q7. What is an Internet Gateway?

**Per AWS:** *"An internet gateway is a horizontally scaled, redundant, and highly available VPC component that allows communication between your VPC and the internet. It supports IPv4 and IPv6 traffic. It does not impose availability risks or bandwidth constraints on your network traffic."*

**It does exactly two things:**

1. Provides a **route target** for internet-bound traffic.
2. Performs **1:1 NAT** between an instance's private IPv4 address and its public IPv4 or Elastic IP.

**Properties:** one IGW per VPC; **free**; no bandwidth constraint; **not zonal** — it is a VPC-wide, regionally redundant construct, so unlike NAT Gateway there is nothing for you to make highly available.

**The three conditions for internet reachability — all required:**

1. IGW attached to the VPC.
2. Route `0.0.0.0/0 → igw-xxxx` in the subnet's route table.
3. A **public IPv4 or Elastic IP** on the ENI, plus permitting SG and NACL rules.

**IPv6:** IPv6 addresses are globally routable, so there is no NAT. For outbound-only IPv6 you attach an **egress-only internet gateway** — the IPv6 analogue of NAT Gateway, and also free.

---

## Q8. What is a NAT Gateway?

**Per AWS:** *"You can use a NAT gateway so that instances in a private subnet can connect to services outside your VPC but external services cannot initiate a connection with those instances."*

**Mechanics:** a **managed, AZ-scoped** service that lives in a **public** subnet, holds an **Elastic IP**, and performs source NAT (port address translation) for traffic originating in private subnets. It scales automatically from 5 Gbps to **100 Gbps** and supports roughly **55,000 simultaneous connections per unique destination** (destination IP + port + protocol). Exceeding that yields `ErrorPortAllocation` — a genuine production failure when thousands of tasks hammer one third-party endpoint (a payment provider's API, for instance).

**Cost — the part most candidates skip:** approximately **$0.045/hour (~$32/month) plus $0.045 per GB processed**, and the per-GB **processing** charge is *on top of* normal data-transfer charges. Three NAT Gateways (one per AZ) cost ~$100/month before a byte moves. On a chatty container platform pulling images and calling S3 through NAT, this silently becomes one of the largest lines on the bill.

**How to reduce it (the standard follow-up):**

| Technique | Effect |
|---|---|
| **Gateway VPC endpoints for S3 and DynamoDB** | **Free.** Traffic bypasses NAT entirely. Always do this. |
| **Interface endpoints (PrivateLink)** for ECR, Secrets Manager, KMS, SSM, STS, CloudWatch Logs | ~$0.01/hr per endpoint per AZ + ~$0.01/GB — cheaper than NAT at volume, and keeps AWS API traffic off the internet (a control auditors like) |
| **Egress-only IGW for IPv6** | Free |
| **Centralised egress VPC** behind Transit Gateway | Fewer NAT Gateways overall; adds TGW attachment + processing cost and a shared failure domain — worth it at tens of VPCs, not at three |
| **VPC Flow Logs analysis first** | Find what is actually generating NAT bytes before optimising blind |

**Alternative:** a self-managed **NAT instance** is cheaper at tiny scale, but you own patching, HA, and throughput. AWS recommends the NAT Gateway; don't propose NAT instances in a bank interview except as a deliberate cost-extreme answer.

---

## Q9. Why should NAT Gateway generally be deployed per AZ?

Two independent reasons — **availability** and **cost**. A complete answer gives both.

**1. Availability.** A NAT Gateway is a **zonal** resource. *Per AWS:* *"If you have resources in multiple Availability Zones and they share one NAT gateway, and if the NAT gateway's Availability Zone is down, resources in the other Availability Zones lose internet access."* A single NAT Gateway therefore converts an AZ failure into a **cross-AZ outage** — you carefully built a multi-AZ topology and then reintroduced a single-AZ dependency into the egress path. There is no "multi-AZ NAT Gateway": you create one per AZ and point each AZ's private route table at its local one.

**2. Cost.** Cross-AZ data transfer is billed (~$0.01/GB each direction) **in addition to** NAT processing. Routing AZ-b's egress through AZ-a's NAT Gateway pays a cross-AZ toll on the way in and the NAT charge on the way out. At real volume the per-AZ deployment is *cheaper*, despite the extra hourly charges.

**The correct pattern — and the structural requirement people miss:**

```
AZ-a: private-rt-a   0.0.0.0/0 → nat-a   (nat-a in public-subnet-a)
AZ-b: private-rt-b   0.0.0.0/0 → nat-b   (nat-b in public-subnet-b)
AZ-c: private-rt-c   0.0.0.0/0 → nat-c   (nat-c in public-subnet-c)
```

**One route table per AZ.** A single shared "private" route table cannot express per-AZ NAT — if you have one private route table for three AZs, you have one NAT Gateway by construction.

**When one NAT is defensible:** non-production environments, or a workload whose egress is negligible and where ~$65/month genuinely matters more than dev availability. Say that explicitly — architects are graded on knowing when a rule bends, not on reciting it absolutely.

---

## Q10. Security Group vs NACL?

**Per AWS:** a security group *"acts as a virtual firewall for your EC2 instances to control incoming and outgoing traffic"* — **stateful**, applied at the **ENI**. A network ACL *"is an optional layer of security for your VPC that acts as a firewall for controlling traffic in and out of one or more subnets"* — **stateless**, applied at the **subnet**.

| | **Security Group** | **Network ACL** |
|---|---|---|
| Applies at | ENI / instance | Subnet |
| **State** | **Stateful** — return traffic automatically allowed | **Stateless** — you must allow the return path explicitly |
| Rule types | **Allow only** | **Allow and Deny** |
| Evaluation | All rules evaluated; any match allows | **Numbered order**, lowest first, **first match wins** |
| Default | Deny all inbound, allow all outbound | Default NACL allows all; a custom NACL denies all |
| Can reference | **Other security groups**, managed prefix lists, CIDRs | **CIDRs only** |
| Quantity | Up to 5 per ENI (raisable to 16) | Exactly 1 per subnet |
| Role | **The primary control** | Coarse guardrail / explicit deny |

**Two mistakes that reveal inexperience:**

1. **Forgetting ephemeral ports on NACLs.** Because NACLs are stateless, allowing inbound `443` without allowing outbound `1024–65535` means responses never leave. Almost every "the NACL broke my app" incident is exactly this.
2. **Not using SG-to-SG references.** `Allow 5432 from sg-app` is far better than `Allow 5432 from 10.0.0.0/16`: it survives IP churn and autoscaling, it documents intent, and it makes "the database only accepts connections from the app tier" a *provable* control at audit rather than an assertion. Highest-value VPC security practice available, and it costs nothing.

**How they combine (defence in depth, per the Well-Architected Security pillar):**

- **Security groups do the real work** — tight, SG-referenced, least-privilege, one SG per role (`sg-alb`, `sg-app`, `sg-db`).
- **NACLs are a blunt guardrail** — deny known-bad CIDRs, or hard-block traffic between a PCI subnet and everything else, as a control an application team cannot silently undo by editing a security group.
- Above both: **AWS Network Firewall** for stateful L3–L7 inspection and egress domain filtering, and **AWS WAF** on CloudFront/ALB for HTTP-layer attacks.

---

## Q11. What is VPC peering?

**Per AWS:** *"A VPC peering connection is a networking connection between two VPCs that enables you to route traffic between them using private IPv4 addresses or IPv6 addresses. Instances in either VPC can communicate with each other as if they are within the same network."*

**Key properties:**

- **Not a gateway or appliance.** There is no device, no bandwidth limit, no single point of failure, and **no hourly charge** — you pay only for data transfer (and cross-AZ/cross-Region rates apply).
- Works **across accounts** and **across Regions** (inter-Region peering; traffic stays on the AWS backbone and is encrypted).
- Requires a **requester/accepter handshake**, then **explicit route table entries on both sides**, then **security group rules on both sides**. Missing any of the three is the usual cause of "peering is active but nothing works".
- **CIDRs must not overlap** (Q13).
- **Not transitive** (Q14).
- Traffic uses **private IPs**; DNS resolution of the peer's private hostnames requires enabling **DNS resolution for the peering connection** on each side.
- Quota: soft limit of 50 active peerings per VPC (raisable to 125) — the number that makes full-mesh impractical at scale (Q15).

**Where it still wins in 2026, despite Transit Gateway existing:** two VPCs, high bandwidth, cost sensitivity. Peering has no per-GB processing fee, while TGW charges an hourly attachment fee **plus ~$0.02/GB processed**. For a high-volume data path between exactly two VPCs, peering is materially cheaper and one hop shorter.

---

## Q12. How do you configure VPC peering step-by-step?

An end-to-end runbook, including the parts people forget:

**0. Pre-check — CIDRs.** Confirm the two VPC CIDRs (and any secondary CIDRs) **do not overlap**. If they do, stop: peering is impossible (Q13).

**1. Create the peering connection** from the requester VPC.
```bash
aws ec2 create-vpc-peering-connection \
  --vpc-id vpc-aaaa1111 \
  --peer-vpc-id vpc-bbbb2222 \
  --peer-owner-id 222222222222 \
  --peer-region eu-west-1
# → returns pcx-0123456789abcdef0 in state "pending-acceptance"
```

**2. Accept it** from the accepter account/Region.
```bash
aws ec2 accept-vpc-peering-connection --vpc-peering-connection-id pcx-0123456789abcdef0
```
The connection moves to `active`. **At this point no traffic flows** — this is the step people mistake for "done".

**3. Add routes on *both* sides.** Every route table serving a subnet that needs to reach the peer requires an entry.
```bash
# In VPC A (10.0.0.0/16) — route to B
aws ec2 create-route --route-table-id rtb-aaa \
  --destination-cidr-block 10.1.0.0/16 \
  --vpc-peering-connection-id pcx-0123456789abcdef0

# In VPC B (10.1.0.0/16) — route back to A
aws ec2 create-route --route-table-id rtb-bbb \
  --destination-cidr-block 10.0.0.0/16 \
  --vpc-peering-connection-id pcx-0123456789abcdef0
```
Route the **narrowest CIDR that satisfies the requirement** — the specific subnets, not the whole VPC — if the security model calls for it.

**4. Update security groups on both sides.** Cross-**account** peering historically could not reference a peer security group; within the **same Region** you *can* reference a peer SG by `sg-xxxx/account-id`. **Cross-Region peering cannot reference security groups at all** — you must use CIDRs there.
```bash
aws ec2 authorize-security-group-ingress --group-id sg-db \
  --protocol tcp --port 5432 --cidr 10.0.10.0/24
```

**5. Check NACLs** on both subnets — inbound *and* outbound, including ephemeral ports.

**6. Enable cross-VPC DNS resolution** if you need private hostname resolution (e.g. resolving an RDS endpoint in the peer VPC to its private IP):
```bash
aws ec2 modify-vpc-peering-connection-options \
  --vpc-peering-connection-id pcx-0123456789abcdef0 \
  --requester-peering-connection-options AllowDnsResolutionFromRemoteVpc=true \
  --accepter-peering-connection-options  AllowDnsResolutionFromRemoteVpc=true
```

**7. Verify** — and verify with the right tool, not by guessing:
```bash
# Deterministic path analysis, no packets needed
aws ec2 create-network-insights-path --source i-aaa --destination i-bbb \
  --protocol tcp --destination-port 5432
aws ec2 start-network-insights-analysis --network-insights-path-id nip-xxx
```
Then a live check: `nc -zv 10.1.20.15 5432`, plus **VPC Flow Logs** to see whether the packet was `ACCEPT` or `REJECT` and on which side.

**In practice**, all of this is Terraform/CloudFormation, not CLI — but knowing the seven steps (and that steps 3–5 are where it actually breaks) is what the question is testing.

---

## Q13. What happens if VPC CIDRs overlap?

**Per AWS:** *"You cannot create a VPC peering connection between VPCs with matching or overlapping IPv4 CIDR blocks."* The API rejects it outright — the same restriction applies to Transit Gateway routing and VPN, because it is not an AWS limitation but a **routing** one: with two identical `10.0.0.0/16` ranges, a route table has no way to determine which side `10.0.1.5` refers to.

**Your options when it has already happened** (and in a bank, after enough acquisitions, it always has):

| Option | How it works | Cost of doing it |
|---|---|---|
| **Re-IP one VPC** | Rebuild with a non-overlapping CIDR and migrate | Cleanest, most expensive; a project, not a change |
| **Add a non-overlapping secondary CIDR** | Attach e.g. `100.64.0.0/16` to each VPC, place only the resources that must communicate in subnets carved from it, and peer using only those ranges | Pragmatic and common; partial connectivity only |
| **AWS PrivateLink** | Expose the specific service behind an NLB and consume it via an interface endpoint. **PrivateLink does not care about overlapping CIDRs** because the consumer talks to a local ENI, not to the provider's IP space | **The standard answer.** Service-level, not network-level, connectivity |
| **Private NAT Gateway** (VPC-to-VPC) | Translate overlapping addresses into a shared non-overlapping range before crossing TGW | Works for bidirectional overlap; adds cost and troubleshooting difficulty |
| **Proxy / API Gateway at the boundary** | Terminate at L7 and re-originate the connection | Fine for HTTP; useless for arbitrary TCP |

**The architect answer:** *"The fix is not a networking trick; it is IP address governance."* Run a central **IPAM** (AWS IPAM or equivalent) that allocates non-overlapping ranges per account, environment and Region before any VPC is created, and enforce it in the account-vending pipeline (Control Tower / Landing Zone). When overlap already exists, my default remediation is **PrivateLink for the specific service** — it is the only option that gives connectivity without a migration project.

---

## Q14. Is VPC peering transitive?

**No.** *Per AWS:* *"Transitive peering is not supported."* If A↔B and B↔C are peered, **A cannot reach C**. Peering is strictly point-to-point.

**Corollaries that are also not supported over a peering connection** — worth naming, because interviewers probe them:

- You cannot route through a peer's **Internet Gateway** (no "borrowing" a peer's internet egress).
- You cannot use a peer's **NAT Gateway**.
- You cannot reach a peer's **VPN or Direct Connect** connection.
- You cannot use a peer's **Gateway VPC endpoints** for S3/DynamoDB.

Each of these is the same rule: a peering connection carries traffic *between the two VPCs*, not *through* one of them.

**Why AWS made this choice:** transitive routing through a VPC would make the VPC a router with an implicit, unaudited trust path — a security and blast-radius problem. AWS pushed that role into a purpose-built construct instead.

**Consequence at scale — the reason Transit Gateway exists:** connecting *n* VPCs with peering requires a full mesh of **n(n−1)/2** connections and route entries in every route table. Ten VPCs = 45 peerings. Twenty = 190. Fifty = 1,225, past the per-VPC quota. It is not just tedious; it is unmanageable and untestable. **Transit Gateway turns an O(n²) mesh into an O(n) hub-and-spoke**, which is the sentence to say out loud.

---

## Q15. VPC Peering vs Transit Gateway?

**Per AWS:** *"AWS Transit Gateway connects your Amazon Virtual Private Clouds (VPCs) and on-premises networks through a central hub. This simplifies your network and puts an end to complex peering relationships. It acts as a highly scalable cloud router."*

| | **VPC Peering** | **Transit Gateway** |
|---|---|---|
| Topology | Point-to-point mesh, **O(n²)** | **Hub-and-spoke, O(n)** |
| Transitive routing | **No** | **Yes** |
| On-premises (VPN / Direct Connect) | Not integrated | **Native** — one VPN/DX to TGW serves all attached VPCs |
| Route control | Route tables per VPC only | **Multiple TGW route tables** → true segmentation (prod / non-prod / shared services / PCI) |
| Bandwidth | No limit (VPC-to-VPC) | **50 Gbps per attachment** (bursts), 100 Gbps per flow limits apply |
| Latency | Lowest — one hop | One extra hop (single-digit ms) |
| **Cost** | **No hourly fee**; data transfer only | ~**$0.05/hour per attachment** + ~**$0.02/GB processed** |
| Cross-Region | Yes | Yes, via **TGW peering** |
| Multicast | No | **Yes** |
| Scaling ceiling | ~125 peerings per VPC | 5,000 attachments per TGW |
| Ops burden | Grows quadratically | Central, auditable, one place to look |

**The decision rule I use:**

- **≤ 3–4 VPCs, no on-premises, no segmentation requirement, high data volume** → **peering**. Cheaper, simpler, one hop.
- **≥ 5 VPCs, or any hybrid connectivity, or a need for network segmentation, or an account-vending pipeline that will keep adding VPCs** → **Transit Gateway**, from the start. Retrofitting TGW onto a peering mesh is a migration project; starting with it is a day-one decision.
- **Hybrid answer, common in large enterprises:** TGW as the backbone for general connectivity, **plus** direct peering for one or two specific high-volume, latency-sensitive paths where the $0.02/GB TGW processing charge is material (e.g. a market-data replication path moving terabytes).

**The segmentation point is the one that wins the question.** TGW route tables let you say "prod VPCs can reach shared services but not each other; the PCI VPC can reach nothing except the payment gateway VPC" — expressed centrally, reviewable, and enforceable. A peering mesh can approximate that only through discipline across dozens of route tables, which does not survive contact with a real organisation.

---

## Q16. Transit Gateway vs PrivateLink?

These are **not competing options** — they operate at different layers, and the best answer says so immediately.

| | **Transit Gateway** | **AWS PrivateLink** |
|---|---|---|
| Layer | **Network** (L3 routing) | **Service** (L4 endpoint to a specific service) |
| What is connected | Whole VPCs / on-premises networks | **One service** behind an NLB/GWLB (or an AWS service) |
| Direction | Bidirectional, any-to-any within policy | **Unidirectional** — consumer → provider only |
| **Overlapping CIDRs** | **Not allowed** | **Allowed** — consumer sees a local ENI, never the provider's IP space |
| Exposure | Entire routable network is reachable subject to routes/SGs | **Only the exposed service**; nothing else in the provider VPC is reachable |
| Consumer sees | Provider's private IPs | An **ENI with an IP in the consumer's own subnet** + a private DNS name |
| Cost | $0.05/hr per attachment + $0.02/GB | ~$0.01/hr per endpoint per AZ + ~$0.01/GB |
| Typical use | Enterprise backbone, hybrid, many VPCs | **SaaS/partner integration**, cross-account service exposure, private access to AWS APIs |

**How to choose, stated as a principle:** *Transit Gateway is for connecting networks you own; PrivateLink is for exposing a service across a trust boundary.*

**Where PrivateLink is clearly right:**
- A **third party or another business unit** must consume one API and nothing else — PrivateLink gives least-privilege connectivity by construction; there is no route to anything but the NLB.
- **Overlapping CIDRs** after a merger (Q13).
- **Private access to AWS services** — interface endpoints for Secrets Manager, KMS, ECR, SSM, and the rest are PrivateLink. This is how you keep AWS API traffic off the internet, which is a standing requirement in most regulated environments.
- The provider must not expose their internal network topology to the consumer — PrivateLink reveals nothing.

**Where Transit Gateway is right:** you own both sides, you need many-to-many routing, you need hybrid on-premises connectivity, or the traffic isn't a single TCP service.

**In a real fintech landing zone you use both:** TGW as the internal backbone across accounts and to the data centre; PrivateLink for every partner/vendor integration and for all AWS-service access from private subnets.

---

## Q17. How do you connect multiple VPCs?

The full option set, with the decision criteria — not just a list:

| Option | Connectivity model | Best for | Watch out for |
|---|---|---|---|
| **VPC Peering** | 1:1, non-transitive, L3 | 2–4 VPCs, high volume, cost-sensitive | O(n²) mesh; no CIDR overlap; no transitive routing |
| **Transit Gateway** | Hub-and-spoke, transitive, L3 | 5+ VPCs, hybrid, segmentation needs | Hourly + per-GB cost; still no CIDR overlap |
| **PrivateLink** | Consumer → one service, L4 | Cross-trust-boundary service exposure; overlapping CIDRs | Unidirectional; one endpoint per service; NLB required on provider side |
| **VPC Sharing (RAM)** | **Same VPC**, subnets shared into other accounts | Account separation *without* network separation; conserves IPs; **no inter-account data-transfer or gateway charges** | Shared blast radius; the owning account controls the network |
| **Cloud WAN** | Managed global backbone with policy-as-code | Many Regions, many segments, global enterprise | Newer, higher cost, more concepts |
| **VPN / Direct Connect** | To on-premises | Hybrid | DX is weeks of lead time; VPN caps ~1.25 Gbps per tunnel |
| **Route 53 + application-layer calls over the internet** | Public endpoints | Truly external integration | Not private; only with strong auth and TLS |

**How I'd answer as an architect:** start from *why* the VPCs are separate, because that determines the connection model.

- Separated for **account/billing/blast-radius** reasons but functionally one network → consider **VPC Sharing** and skip inter-VPC connectivity entirely. Under-used, and it eliminates a whole class of cost and complexity.
- Separated for **environment** (prod/non-prod) → **do not connect them at all** except through a controlled path. Non-prod reaching prod is an audit finding waiting to happen.
- Separated by **domain/team** and needing broad communication → **Transit Gateway** with route-table segmentation.
- Separated by **trust boundary** (vendor, partner, PCI zone) → **PrivateLink**, service by service.

**Reference topology for a regulated platform:**

```
                        ┌──────────────────────────┐
   on-prem ── DX/VPN ──▶│    Transit Gateway       │
                        │  (route tables:          │
                        │   prod | nonprod |       │
                        │   shared | inspection)   │
                        └───┬────┬────┬────┬───────┘
                            │    │    │    │
                     ┌──────┘    │    │    └────────┐
             ┌───────▼──┐  ┌─────▼──┐ ┌─▼────────┐ ┌▼────────────┐
             │ Prod VPC │  │ Shared │ │ Egress   │ │ Inspection  │
             │          │  │ svcs   │ │ VPC(NAT) │ │ VPC (NFW)   │
             └──────────┘  └────────┘ └──────────┘ └─────────────┘
                  │ PrivateLink endpoints (KMS, Secrets, ECR, S3-GW)
                  ▼
             partner service (PrivateLink consumer endpoint)
```

---

## Q18. How do you troubleshoot VPC connectivity?

A deterministic checklist, worked **outside-in along the packet path**. The discipline matters more than any single tool — connectivity bugs are almost always one of six things.

**Step 0 — use the tool that removes guesswork first.** **VPC Reachability Analyzer** performs static path analysis between two ENIs/resources and tells you *exactly which component blocks the path* without sending a packet:
```bash
aws ec2 create-network-insights-path --source i-app --destination i-db \
  --protocol tcp --destination-port 5432
aws ec2 start-network-insights-analysis --network-insights-path-id nip-xxx
# result names the blocking component: route table, SG, NACL, or missing gateway
```
For live traffic, **Network Access Analyzer** validates intent ("can anything in the PCI subnet reach the internet?"), and **VPC Flow Logs** show what actually happened.

**Then the six causes, in the order they occur in practice:**

| # | Check | Symptom when wrong | How to confirm |
|---|---|---|---|
| 1 | **Security group** (both directions, both sides) | Connection **hangs then times out** | Flow Logs show no matching `ACCEPT`; SG is the most common cause by a wide margin |
| 2 | **NACL** (stateless — inbound *and* outbound, ephemeral ports 1024–65535) | Works one way, times out the other | Flow Log shows `REJECT` |
| 3 | **Route table** (correct table associated with the subnet; route to the destination exists on **both** sides) | Times out; often "worked in AZ-a, not AZ-b" | `describe-route-tables`; check the *association*, not just the routes |
| 4 | **Gateway present and attached** — IGW/NAT/TGW attachment/peering `active` | No egress at all | Peering shows `active` but routes missing is the classic |
| 5 | **DNS** — `enableDnsSupport` / `enableDnsHostnames`, Route 53 private hosted zone associated with the VPC, cross-VPC DNS resolution enabled | `Name or service not known`, or resolves to a **public** IP instead of a private one | `dig`, `nslookup` from inside the VPC |
| 6 | **The application/host itself** — process not listening, bound to `127.0.0.1`, host firewall (`iptables`, Windows Firewall), TLS/cert failure | **Connection refused** (fast) rather than timeout | `ss -lntp`, `curl -v`, container logs |

**The single most useful diagnostic distinction:** *timeout = something dropped it silently (SG, NACL, routing); connection refused = the packet arrived and nothing was listening.* That one sentence halves the search space instantly and is exactly what a panel wants to hear.

**Fintech-flavoured example:** a payment service intermittently fails to reach the settlement provider. Flow Logs show `ACCEPT` outbound, no return. Cause: the third party allow-lists source IPs, and only two of the three NAT Gateway Elastic IPs were registered — so requests egressing via AZ-c were dropped at the provider. Symptom: exactly one-third of calls failing. Fix: register all NAT EIPs, and alert on any change to them.

---

## Q19. How do you secure a VPC?

Layered, per the Well-Architected **Security** pillar, from the outside in. Each layer answers a different attacker question.

**1. Topology — make bad things structurally impossible.**
- Three tiers: public (LB + NAT only), private (compute), isolated (data, **no `0.0.0.0/0` route at all**).
- No public IPs on compute. No bastion — **SSM Session Manager** with session logging to S3/CloudWatch instead, which also gives you an audit trail of every administrative session.
- Separate VPCs/accounts per environment and per trust zone; never peer non-prod to prod.

**2. Access control at the packet layer.**
- Security groups as the primary control, **SG-to-SG referenced**, least privilege, one SG per role.
- NACLs as coarse guardrails for controls that must not be undoable by an app team.
- **AWS Network Firewall** for stateful inspection and **egress domain filtering** — outbound control is the layer most teams omit and the one that limits data exfiltration and C2 traffic.

**3. Keep traffic off the internet.**
- **Gateway endpoints** for S3/DynamoDB, **interface endpoints** for every AWS API in use.
- Apply **endpoint policies** *and* S3 bucket policies with `aws:SourceVpce` conditions, so data can only be pulled through your endpoint — this is the control that turns "we use S3 privately" into something provable.

**4. Identity, because network controls are not enough.**
- IAM roles for all workloads (IRSA on EKS, task roles on ECS) — never long-lived keys.
- **VPC endpoint policies + SCPs + `aws:PrincipalOrgID` conditions** to stop data moving to a foreign account.

**5. Encryption.**
- TLS everywhere in transit, including internal service-to-service (mTLS via a service mesh or ALB/NLB TLS).
- KMS-backed encryption at rest on every store; CMKs with key policies for regulated data.

**6. Detection and evidence — the part regulated firms grade hardest.**
- **VPC Flow Logs** (all traffic, to S3 + CloudWatch), **DNS query logging** (Route 53 Resolver), **CloudTrail** organisation trail, **GuardDuty** (which consumes Flow Logs, DNS and CloudTrail), **Security Hub**, **AWS Config** rules for drift (`vpc-default-security-group-closed`, `vpc-sg-open-only-to-authorized-ports`, restricted-SSH, no-public-RDS).
- Alert on: security group changes, route table changes, IGW attachment, NACL changes, NAT EIP changes, and any `0.0.0.0/0` ingress rule created anywhere.

**7. Guardrails that prevent, not just detect.** SCPs at the OU level denying `ec2:CreateInternetGateway`, `ec2:DeleteFlowLogs`, disabling of GuardDuty/Config, and creation of resources outside approved Regions. Prevention beats detection at audit time, and it beats a 3 a.m. page.

---

## Q20. What is IAM?

**Per the IAM User Guide:** *"AWS Identity and Access Management (IAM) is a web service that helps you securely control access to AWS resources. You use IAM to control who is authenticated (signed in) and authorized (has permissions) to use resources."*

**IAM is global, eventually consistent, and free** — and it is the *actual* security perimeter in AWS. Network controls limit reachability; IAM decides what any authenticated principal may do.

**The object model:**

| Object | What it is |
|---|---|
| **Principal** | The entity making a request: IAM user, IAM role session, AWS service, federated identity, or the root user |
| **IAM user** | A long-lived identity with credentials (password and/or access keys) |
| **IAM group** | A container for users, to attach policies once |
| **IAM role** | An identity with permissions but **no long-lived credentials** — assumed to obtain **temporary** credentials from STS |
| **Identity-based policy** | JSON attached to a user/group/role: what *this principal* may do |
| **Resource-based policy** | JSON attached to a resource (S3 bucket, KMS key, SQS queue, Lambda): who may act *on this resource*, including cross-account |
| **Permissions boundary** | A ceiling on the maximum permissions an identity policy can grant — used to let teams create roles safely |
| **SCP (Organizations)** | An account/OU-wide ceiling — **never grants**, only restricts |
| **Session policy** | A further restriction passed at `AssumeRole` time |
| **IAM Identity Center** | Workforce SSO — the modern front door for humans |

**Policy evaluation logic — the part that gets asked:**

1. **Explicit `Deny` anywhere wins**, always, unconditionally.
2. Otherwise, an **SCP** must allow it (for member accounts).
3. Otherwise, a **permissions boundary** must allow it (if attached).
4. Otherwise, an identity-based **or** resource-based policy must allow it (cross-account requires **both** sides).
5. **Default is implicit deny.**

**Policy anatomy, with the elements that make policies precise:**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "ReadPaymentObjectsFromVpcOnly",
    "Effect": "Allow",
    "Action": ["s3:GetObject"],
    "Resource": "arn:aws:s3:::payments-archive/settlements/*",
    "Condition": {
      "StringEquals": { "aws:SourceVpce": "vpce-0abc123" },
      "Bool": { "aws:SecureTransport": "true" }
    }
  }]
}
```
The `Condition` block is where architect-level IAM lives: `aws:PrincipalOrgID`, `aws:SourceVpce`, `aws:SourceIp`, `aws:RequestedRegion`, `aws:MultiFactorAuthPresent`, `kms:ViaService`, and tag conditions (`aws:ResourceTag/…`) for attribute-based access control.

---

## Q21. IAM User vs IAM Role?

| | **IAM User** | **IAM Role** |
|---|---|---|
| Credentials | **Long-lived** — password, access key + secret | **None held**; STS issues **temporary** credentials on assume |
| Lifetime | Until manually rotated or deleted | 15 min – 12 h (1 h default), auto-rotated |
| Who uses it | A specific human or (legacy) an application | **Anyone/anything permitted to assume it** — EC2, Lambda, ECS task, EKS pod, a user, another account, a federated identity |
| Trust | N/A | Governed by a **trust policy** (`AssumeRolePolicyDocument`) — who may assume |
| Cross-account | Requires sharing keys — never do this | **The** cross-account mechanism |
| Auditability | Actions attributed to the user | CloudTrail shows the assuming principal *and* the role session name |
| Leak blast radius | Valid until someone notices and rotates | Expires on its own, usually within an hour |

**How a role is actually consumed:**
```jsonc
// Trust policy — WHO may assume
{ "Effect": "Allow",
  "Principal": { "Service": "ecs-tasks.amazonaws.com" },
  "Action": "sts:AssumeRole",
  "Condition": { "ArnLike": { "aws:SourceArn": "arn:aws:ecs:eu-west-1:111122223333:*" },
                 "StringEquals": { "aws:SourceAccount": "111122223333" } } }
```
The `aws:SourceArn`/`aws:SourceAccount` conditions on a service trust policy are the **confused-deputy** mitigation — naming that unprompted is a strong signal.

**Where roles come from in each runtime:**

| Runtime | Mechanism |
|---|---|
| EC2 | Instance profile → credentials from **IMDSv2** (`169.254.169.254`) |
| ECS / Fargate | **Task role** (application) vs **execution role** (pull image, write logs) — distinguishing these two is a common interview probe |
| Lambda | Execution role |
| **EKS** | **IRSA** (IAM Roles for Service Accounts) via OIDC federation, or **EKS Pod Identity** — per-pod credentials, not per-node |
| Humans | **IAM Identity Center** federated from Entra ID / Okta |
| CI/CD (GitHub Actions) | **OIDC federation** — no stored AWS keys in the pipeline |

**In .NET,** you never handle any of this in code: the AWS SDK's default credential chain resolves environment → container credential URI → IMDS automatically, so `new AmazonS3Client()` picks up the task role. If your code contains an access key, the design is already wrong.

---

## Q22. Why prefer IAM Roles?

Six reasons, in the order I'd actually rank them:

1. **No long-lived secret exists.** You cannot leak what does not exist. The single largest category of real AWS breaches is a long-lived access key committed to a repository, pasted into a ticket, or left in a container image. Roles remove the class of failure rather than mitigating it.
2. **Automatic rotation.** STS credentials expire in ≤12 h and the SDK refreshes them transparently — the rotation problem disappears instead of becoming a quarterly control you have to evidence.
3. **Bounded blast radius on compromise.** A stolen role credential is useless within the hour; a stolen access key is useful until someone notices.
4. **Cross-account access without shared secrets.** Role assumption with `ExternalId` (for third parties) or `aws:PrincipalOrgID` (internally) is the only sane way to do cross-account access.
5. **Better auditability.** CloudTrail records `AssumeRole` with the source principal and a **role session name**, so a shared role still attributes actions to an individual — impossible with a shared user.
6. **Conditional, contextual access.** Trust policies and session policies let you require MFA, restrict source VPC endpoint, restrict Region, and scope down per session. Users with static keys give you none of that.

**The exceptions where a user is still justified** — and naming them shows judgement rather than dogma: a legacy on-premises system with no way to federate (and even then, **IAM Roles Anywhere** with X.509 certificates is the modern answer), and some third-party SaaS integrations that only accept keys (push back and ask for role assumption with an `ExternalId` first). If you must issue keys: scope them to one action, rotate automatically, monitor with **IAM Access Analyzer** unused-access findings, and alert on use from unexpected IPs.

**The governance layer that makes this real:** an SCP denying `iam:CreateAccessKey` across the organisation, with a narrow exception OU. Policy without enforcement is a wish.

---

## Q23. Explain least privilege.

**Per the Well-Architected Security pillar:** *"Implement least privilege access — grant only the access that identities require to perform specific actions on specific resources under specific conditions."*

Note the three axes in AWS's own wording: **actions**, **resources**, **conditions**. Most teams do actions, some do resources, almost nobody does conditions — and conditions are where the strongest controls live.

**What it looks like in practice, from worst to best:**

```jsonc
// ✗ Ownership, not privilege
{ "Effect": "Allow", "Action": "s3:*", "Resource": "*" }

// ~ Better, still broad
{ "Effect": "Allow", "Action": "s3:*", "Resource": "arn:aws:s3:::payments-archive/*" }

// ✓ Actions, resource, and conditions
{ "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject"],
  "Resource": "arn:aws:s3:::payments-archive/settlements/${aws:PrincipalTag/team}/*",
  "Condition": {
    "Bool": { "aws:SecureTransport": "true" },
    "StringEquals": { "aws:SourceVpce": "vpce-0abc123",
                      "s3:x-amz-server-side-encryption": "aws:kms" } } }
```

**How you get there without guessing** — this is the practical half of the answer:

| Tool | Use |
|---|---|
| **IAM Access Analyzer — policy generation** | Generates a least-privilege policy **from actual CloudTrail activity**. Start permissive in dev, generate, then lock down. |
| **IAM Access Analyzer — external access findings** | Finds resources shared outside the account/organisation |
| **IAM Access Analyzer — unused access** | Finds roles, users, permissions and keys that haven't been used in N days |
| **Last Accessed data** (`iam:GetServiceLastAccessed*`) | Which services a principal actually touched |
| **Permissions boundaries** | Let dev teams create their own roles without privilege escalation |
| **SCPs** | Organisation-wide floor: deny root usage, deny disabling CloudTrail/GuardDuty/Config, deny non-approved Regions, deny key creation |

**The operating model that makes least privilege sustainable** (and the point that separates a Principal answer from a Senior one): least privilege is a **process**, not a state. Permissions only ever grow unless something removes them. So: start from deny, grant on evidence, review continuously with Access Analyzer unused-access findings, expire access automatically (temporary elevation via Identity Center, break-glass roles with alerting), and treat IAM as code reviewed in a pull request — never as console clicks. In a bank, add: separation of duties (the person who deploys is not the person who approves), and no standing production write access for humans at all.

---

## Q24. What is KMS?

**Per the AWS KMS Developer Guide:** *"AWS Key Management Service (AWS KMS) is a managed service that makes it easy for you to create and control the cryptographic keys that are used to protect your data. AWS KMS uses hardware security modules (HSMs) that have been validated under FIPS 140-3... to protect and validate your AWS KMS keys."*

**The central design fact: plaintext key material never leaves KMS.** You send data *to* KMS to be encrypted/decrypted (limited to 4 KB), or — far more commonly — you use **envelope encryption**.

**Envelope encryption, which is what actually happens for S3, EBS, RDS and every large object:**

```
1. GenerateDataKey → KMS returns:  plaintext DEK  +  encrypted DEK (wrapped by the CMK)
2. Encrypt the data locally with the plaintext DEK (AES-256-GCM)
3. Store: ciphertext + encrypted DEK together
4. Discard the plaintext DEK from memory
5. To read: send the encrypted DEK to KMS → Decrypt → plaintext DEK → decrypt data locally
```
Why: bulk data never crosses the network to KMS, throughput is not bound by KMS limits, and revoking the CMK renders every DEK — and therefore all the data — unusable at once. That last property is **crypto-shredding**, the practical mechanism for "delete this customer's data irreversibly" under GDPR.

**Key types and the choice between them:**

| Type | Control | Cost | Use when |
|---|---|---|---|
| **AWS managed** (`aws/s3`, `aws/rds`) | AWS controls policy and rotation | Free | Low-sensitivity defaults |
| **Customer managed (CMK)** | **You** control key policy, grants, rotation, and can disable/delete | ~$1/month + $0.03 per 10k requests | **Anything regulated** — you need the key policy and the audit trail |
| **Imported key material (BYOK)** | You supply material; you own the master copy | Same | Regulatory requirement to hold key material outside AWS |
| **Custom key store (CloudHSM / External)** | Keys in a dedicated HSM cluster or an external HSM | Much higher | Strict FIPS/HSM-custody mandates |
| **Multi-Region keys** | Same key ID and material replicated across Regions | Per-Region charge | Cross-Region DR of encrypted data — **needed**, because a normal CMK is Region-bound |

**Points that score:**

- **Key policy is mandatory and authoritative.** Unlike most resources, a KMS key's resource policy is not optional — an IAM policy alone cannot grant access unless the key policy delegates to IAM. Locking yourself out of a key is permanent.
- **Automatic rotation** (annual, or a custom period) rotates the *backing material* while the key ID stays stable; old material is retained so old ciphertext still decrypts.
- **Deletion has a mandatory 7–30 day waiting period**, and it is irreversible. Alarm on `ScheduleKeyDeletion` — it is both a fat-finger risk and a ransomware indicator.
- **`kms:ViaService` condition** restricts a key so it can only be used through a named service (e.g. only via `s3.eu-west-1.amazonaws.com`) — a strong, under-used control.
- **Every KMS API call is logged to CloudTrail**, which is exactly what an auditor asks for: who decrypted what, when.
- **Quotas are real.** Symmetric operations are capped (tens of thousands of req/s, per Region, shared) — envelope encryption with **data key caching** is how high-throughput systems stay under it.

---

## Q25. KMS vs Secrets Manager?

They solve **different problems** and are normally used **together**, which is the first thing to say.

| | **AWS KMS** | **AWS Secrets Manager** |
|---|---|---|
| Manages | **Encryption keys** | **Secrets** — DB credentials, API keys, tokens |
| Stores your data? | **No** — it stores keys and performs crypto operations | **Yes** — stores the secret value (encrypted with a KMS key) |
| Payload | 4 KB direct crypto; unlimited via envelope encryption | Up to **64 KB** per secret |
| **Rotation** | Rotates **key material** automatically; key ID unchanged | **Rotates the secret itself** via a Lambda — including changing the password in RDS |
| Native integrations | S3, EBS, RDS, DynamoDB, SQS, SNS, Lambda env vars… (encryption at rest everywhere) | RDS/Aurora/Redshift/DocumentDB managed rotation; ECS/EKS/Lambda retrieval |
| Cost | ~$1/key/month + $0.03/10k requests | **$0.40 per secret per month** + $0.05/10k API calls |
| Cross-account | Key policy + grants | Resource policy |

**The relationship:** Secrets Manager **uses** KMS to encrypt what it stores. You choose which CMK; using a customer-managed CMK is what lets you write a key policy restricting who can decrypt a secret even if their IAM policy allows `secretsmanager:GetSecretValue` — defence in depth across two policy surfaces.

**Choose KMS when** you need to encrypt data (fields, files, PII in a column, a message payload) or control the key lifecycle for compliance.
**Choose Secrets Manager when** you need to store and, critically, **rotate** a credential, with an application retrieving it at runtime.

**The feature that justifies Secrets Manager's price:** **automatic rotation with a two-user strategy.** For RDS, the rotation Lambda alternates between two database users, so there is never a window where the stored credential is invalid — no downtime, no rotation-day incident. Building that yourself is exactly the kind of undifferentiated work that costs more than $0.40/month.

**In .NET:** cache the secret in memory with a refresh interval (`IMemoryCache` + a background refresh, or the AWS Secrets Manager caching library). Do **not** call `GetSecretValue` per request — it is a throttled, billed API and adds latency to every call. Cache for minutes, and handle the rotation case by retrying once on an authentication failure with a forced refresh; that retry is what makes rotation invisible to the application.

---

## Q26. Secrets Manager vs Parameter Store?

**Per AWS:** Parameter Store *"provides secure, hierarchical storage for configuration data management and secrets management"*, while Secrets Manager *"helps you protect access to your applications, services, and IT resources without the upfront investment and on-going maintenance costs of operating your own infrastructure."*

| | **Secrets Manager** | **Parameter Store (SSM)** |
|---|---|---|
| Purpose | Secrets that must **rotate** | **Configuration** — plus secrets, via `SecureString` |
| Encryption | Always, via KMS | `String`/`StringList` plain; **`SecureString`** via KMS |
| **Automatic rotation** | **Yes**, built in, with RDS/Redshift/DocumentDB templates | **No** — you build it |
| Cost | **$0.40/secret/month** + $0.05/10k calls | **Standard: free** (10k params). Advanced: $0.05/param/month |
| Size | 64 KB | Standard 4 KB / Advanced 8 KB |
| Cross-account | **Yes** (resource policy) | Only via Advanced + RAM/ custom, more awkward |
| Versioning | Yes, with staging labels (`AWSCURRENT`, `AWSPENDING`) | Yes, version history |
| Hierarchy | Flat names (convention-based paths) | **Native hierarchy** — `/prod/payments/db/host`, `GetParametersByPath` |
| Replication | **Cross-Region replication built in** | Not built in |
| Throughput | 10k/s (varies) | Standard 40/s, **Advanced/higher-throughput 1,000/s+** |

**How I actually split them in a production estate:**

- **Parameter Store** for non-secret configuration — feature flags, endpoint URLs, timeouts, queue names, tuning values. It is **free**, hierarchical, and integrates cleanly with ECS task definitions and CloudFormation dynamic references. Config lives here.
- **Secrets Manager** for anything that (a) must rotate automatically, (b) is shared cross-account, (c) is a database credential, or (d) sits under an explicit regulatory rotation requirement. Credentials live here.

**The cost argument, stated honestly:** at 500 secrets, Secrets Manager is $200/month and Parameter Store SecureString is effectively free. That is not a large number for a bank, and *rotation* — not storage — is what you are buying. If a secret genuinely never rotates and is not a credential, Parameter Store `SecureString` with a customer-managed CMK is a perfectly defensible choice; say that rather than reflexively recommending the pricier service.

**What matters more than either choice:** the secret must never be in source control, never in a container image, never in a plain environment variable in a task definition (use the `secrets` block so ECS injects it at runtime and the value is not visible in the definition), and every retrieval must be IAM-scoped and CloudTrail-logged. **HashiCorp Vault** is the common alternative in banks that need one secrets plane across cloud and data centre — worth naming so the answer isn't AWS-only.

---

## Q27. EC2 vs ECS vs EKS vs Lambda?

Four points on the **operational-responsibility spectrum**. The right framing is "how much of the stack do I want to own, and what does that buy me?"

| | **EC2** | **ECS** | **EKS** | **Lambda** |
|---|---|---|---|---|
| Unit | Virtual machine | Container / task | Container / pod | Function invocation |
| You manage | OS, patching, runtime, scaling, AMIs | Task definitions (+ nodes if EC2 launch type) | K8s workloads, add-ons, upgrades (+ nodes) | Code only |
| AWS manages | Hypervisor, hardware | Control plane, scheduling | **Control plane ($0.10/hr)**, etcd, API server | Everything |
| Scaling | ASG, minutes | Service autoscaling, ~30 s | HPA/Karpenter, seconds–minutes | **Per request, ~ms** |
| Cold start | N/A (always on) | Container start (seconds) | Pod start (seconds) | **50 ms–2 s**, worse in a VPC/large package (SnapStart helps .NET/Java) |
| Max duration | Unlimited | Unlimited | Unlimited | **15 minutes** |
| Pricing | Per second, running or not | Per task (Fargate) or per EC2 | Control plane + nodes | **Per ms + memory**; zero when idle |
| Portability | Low | AWS-only | **High — standard Kubernetes** | Lowest (most lock-in) |
| Best for | Legacy, licensed software, specialised hardware, full OS control | **Containerised services on AWS with minimal ops** | Multi-cloud/hybrid, complex platform needs, existing K8s skills | Event-driven, spiky, glue, cron |

**Fargate is a launch type, not a service** — it removes node management from **both** ECS and EKS. `ECS + Fargate` and `EKS + Fargate` are legitimate answers and are what "serverless containers" means. Getting this right matters; candidates often present Fargate as a fourth compute service.

**How I decide, in order:**

1. **Is it a short, event-driven, stateless unit of work?** → **Lambda**. Best cost model in existence for spiky traffic and no servers to patch. Rule it out if you need >15 min, sustained high throughput (at constant load, containers get cheaper), sub-10 ms p99 with no cold-start tolerance, or long-lived connections (WebSockets, Kafka consumers with heavy state).
2. **Is it a long-running containerised service, AWS-only, and does the team lack deep Kubernetes skill?** → **ECS on Fargate**. Materially lower operational cost than EKS, no control-plane fee, no cluster upgrades, and it is genuinely enough for most microservices estates. This is the answer most large .NET shops should give and often don't.
3. **Do you need Kubernetes specifically** — multi-cloud portability, an existing platform team, service mesh, operators, Helm ecosystem, complex scheduling, or on-prem parity? → **EKS**. Accept that you now own upgrades (roughly every 4 months, per the K8s support window), CNI/IP planning, add-on lifecycle and a platform team.
4. **Do you need OS-level control, a licensed appliance, GPUs, or a lift-and-shift?** → **EC2**.

**The honest trade-off to voice:** EKS is chosen for reasons that are frequently organisational (skills, portability posture, vendor negotiation) rather than technical. If a panel asks "why EKS over ECS?", the strong answer names the *specific* Kubernetes capability being bought and acknowledges the operational cost — not "it's the standard".

---

## Q28. ECS vs EKS?

| | **Amazon ECS** | **Amazon EKS** |
|---|---|---|
| Orchestrator | AWS-proprietary | **Upstream Kubernetes**, CNCF-conformant |
| Control-plane cost | **Free** | **~$0.10/hour (~$73/month) per cluster** |
| Learning curve | Low — task definitions, services, clusters | High — pods, deployments, services, ingress, CRDs, RBAC, operators |
| Config surface | Task definition JSON | YAML manifests / Helm / Kustomize |
| Networking | `awsvpc` mode: an ENI per task | **VPC CNI: an IP per pod** — drives serious subnet planning (Q4) |
| IAM integration | **Task roles** — simple and native | **IRSA / Pod Identity** via OIDC — powerful, more moving parts |
| Service discovery | Cloud Map / ECS Service Connect | CoreDNS, K8s Services, optional mesh |
| Ecosystem | AWS-native only | Enormous — Argo, Istio, KEDA, Prometheus, operators |
| Upgrades | AWS handles it invisibly | **You own cluster and add-on upgrades**, ~3 releases/year (standard + extended support windows) |
| Portability | None | High, at least in principle |
| Multi-tenancy | Basic | Namespaces, RBAC, quotas, network policies, admission control |

**Where each is genuinely the better answer:**

- **ECS** — an AWS-committed organisation, a team of application engineers rather than platform engineers, dozens (not hundreds) of services, and a desire to spend engineering time on the product. ECS on Fargate has the lowest total operational cost of any container option on AWS. **Service Connect** closed much of the historical service-discovery/mesh gap.
- **EKS** — you already run Kubernetes elsewhere; you need a specific ecosystem component (Argo CD, Istio/Linkerd mTLS, KEDA event-driven scaling, an operator for a stateful system); you need strong multi-tenancy; or portability is a stated (and genuinely exercised) requirement.

**The point most candidates miss:** *portability is mostly theoretical*. A real EKS deployment uses IRSA, ALB Ingress Controller, EBS CSI, Karpenter, IAM, KMS and Secrets Manager. Moving that to another cloud is a re-platforming project, not a `kubectl apply`. So justify EKS on ecosystem and skills, not on a lock-in argument you won't actually exercise — and if the panel is a bank that mandates Kubernetes as its standard compute platform (many do), say that the enterprise standard is itself a legitimate architectural constraint.

**Current nuance worth raising:** **EKS Auto Mode** narrows the operational gap. Per the EKS User Guide, with Auto Mode *"EKS extends its control to manage Nodes (Kubernetes data plane) as well… automatically provisioning infrastructure, selecting optimal compute instances, dynamically scaling resources, continuously optimizing costs, patching operating systems, and integrating with AWS security services."* AWS also now ships **EKS Capabilities** — fully managed **Argo CD**, **AWS Controllers for Kubernetes (ACK)** and **kro** — which removes much of the platform-component maintenance that used to be the strongest argument against EKS. If the panel expects a current answer, say this: the ECS-vs-EKS operational delta in 2026 is smaller than the folklore suggests, and the decision now turns mostly on skills, ecosystem and enterprise standards.

**For .NET microservices specifically:** both run containers identically. ECS reaches production faster; EKS pays off when you already have a platform team and need the ecosystem. The deciding question is *"who operates the platform on day 400?"*

---

## Q29. What is RDS?

**Per AWS:** *"Amazon Relational Database Service (Amazon RDS) is a web service that makes it easier to set up, operate, and scale a relational database in the cloud. It provides cost-efficient, resizable capacity for an industry-standard relational database and manages common database administration tasks."*

**Engines:** PostgreSQL, MySQL, MariaDB, Oracle, **SQL Server**, Db2, and **Amazon Aurora** (PostgreSQL- and MySQL-compatible, AWS's own storage engine).

**What AWS operates vs what remains yours:**

| AWS handles | You still own |
|---|---|
| Provisioning, OS and engine patching | **Schema design and indexing** |
| Automated backups, PITR (to 35 days), snapshots | **Query performance** — RDS will not fix an N+1 |
| **Multi-AZ failover** | Connection management / pooling |
| Read replicas, storage autoscaling | Capacity sizing and cost |
| Encryption at rest (KMS) and in transit (TLS) | Parameter-group tuning |
| Monitoring — CloudWatch, **Performance Insights**, Enhanced Monitoring | Data model and access patterns |

**Aurora deserves separate mention** because it is a different architecture, not a tuned MySQL/Postgres: storage is a distributed, log-structured, 6-way-replicated (3 AZs × 2) service decoupled from compute; failover is typically **< 30 seconds**; up to 15 read replicas share the same storage volume (so replica lag is typically **milliseconds**, not seconds); and **Aurora Serverless v2** scales capacity in fine-grained ACU increments. For a new relational workload on AWS with no licensing constraint, Aurora PostgreSQL is usually the right default.

**What to say about limits, because it is the mark of experience:** RDS is a **managed instance**, not a distributed database. Writes still go to **one** primary — you scale writes by sharding, by moving work out of the database, or by choosing a different data store. You cannot get OS access (which rules out some legacy agents), and major-version upgrades still require planning and a maintenance window. In a payments system, RDS/Aurora PostgreSQL is exactly right for the ledger — ACID, constraints, and boring reliability — with the high-volume, high-cardinality data (event streams, audit trails) living elsewhere.

---

## Q30. Multi-AZ vs Read Replica?

The single most confused pair in AWS interviews. **They solve entirely different problems.**

| | **Multi-AZ** | **Read Replica** |
|---|---|---|
| Purpose | **High availability / DR** | **Read scaling** |
| Replication | **Synchronous** (Multi-AZ instance) | **Asynchronous** |
| Standby readable? | **No** in classic Multi-AZ instance deployment; **yes** in **Multi-AZ DB cluster** (2 readable standbys) | **Yes** — that is the point |
| Failover | **Automatic**, DNS CNAME flip, 60–120 s (Aurora < 30 s) | **Manual promotion**, and it becomes a standalone DB |
| Data loss on failover | **None** — synchronous | **Possible** — replication lag |
| Cross-Region | Multi-AZ is in-Region by definition | **Yes** — cross-Region read replicas are a real DR tool |
| Cost | 2× (you pay for the standby you cannot use) | 1× per replica |
| Affects RPO/RTO | RPO ≈ 0, RTO ≈ 1–2 min | RPO = lag, RTO = manual promotion time |

**The two things to state explicitly:**

1. **Multi-AZ is not a scaling feature.** The classic standby serves no traffic; it exists to take over. Paying for Multi-AZ and expecting more read throughput is a common and expensive misunderstanding.
2. **Read replicas are not a real HA feature.** They lag, they need manual promotion, and promotion loses whatever hadn't replicated. They are a useful *DR complement* (especially cross-Region) but not an availability mechanism.

**You normally want both:**
```
Region eu-west-1                         Region eu-central-1
┌────────────────────────────────┐       ┌──────────────────────┐
│ Primary (AZ-a) ⇄ sync ⇄ Standby│       │ Cross-Region read    │
│      │                  (AZ-b) │──────▶│ replica (DR)         │
│      └── async ──▶ Read replica│       │ promote on Region    │
│                    (reporting) │       │ failure              │
└────────────────────────────────┘       └──────────────────────┘
```

**Application consequence you must design for:** read replicas are **eventually consistent**. Reading your own write from a replica returns stale data — the classic "customer pays, is redirected to their balance, and sees the old balance" bug. Mitigations: route reads-after-write to the primary for a short window, use a session/consistency token, or make the UI reflect the command result rather than re-querying. In a ledger, **balance reads go to the primary. Always.** Reporting, statements and analytics go to replicas.

**Aurora nuance:** Aurora replicas share one storage volume, so lag is typically milliseconds and a replica can be an automatic failover target with a defined priority — Aurora blurs this distinction in a way classic RDS does not.

---

## Q31. RDS vs DynamoDB?

| | **RDS / Aurora** | **DynamoDB** |
|---|---|---|
| Model | Relational, SQL, joins, constraints | **Key-value / document**, no joins |
| Schema | Fixed, enforced, migrated | Schemaless apart from the key |
| Scaling | **Vertical** for writes; replicas for reads | **Horizontal, effectively unbounded** — partitioned automatically |
| Performance | Good; degrades as data/queries grow | **Single-digit-millisecond, flat as data grows** |
| Transactions | **Full ACID**, multi-table, arbitrary complexity | ACID via `TransactWriteItems` — **max 100 items**, single Region |
| Query flexibility | **Any query you can write** | Only via keys and indexes — **access patterns must be known up front** |
| Consistency | Strong by default | **Eventually consistent by default**; strongly consistent reads optional (2× cost, primary partition only) |
| Ops | Patching windows, upgrades, connection limits | Fully serverless; no connections, no version to upgrade |
| Cost model | Per instance-hour + storage | **Per request** (on-demand) or provisioned capacity + storage |
| Global | Cross-Region replicas / Aurora Global Database | **Global Tables** — active-active multi-Region, last-writer-wins |
| Backups | Automated + PITR | PITR (35 days) + on-demand |

**The decision rule:** *Do you know your access patterns, and do you need them to be fast and unbounded — or do you need arbitrary querying and relational integrity?*

**Choose RDS/Aurora when:** relationships and joins matter; you need multi-row/multi-table ACID transactions with real constraints; queries are ad hoc or reporting-driven; the domain has genuine referential integrity (a **ledger, positions, trades, customers, accounts**); or the team's productivity depends on SQL. In a regulated fintech, the book of record is almost always relational, and defending that in an interview is usually the *correct* answer rather than the boring one.

**Choose DynamoDB when:** access is by a known key; you need predictable single-digit-ms latency at any scale; the write rate is high and spiky (session state, idempotency keys, event/audit sinks, device state, shopping carts, rate-limit counters, **outbox and idempotency stores**); or you want zero operational surface.

**The trap answer to avoid:** "DynamoDB because it scales." Scaling is not free of consequence — you must design the table around access patterns (single-table design), you cannot ad-hoc query later, hot partitions are a real failure mode (a `payments#2026-09-08` partition key concentrates a day's traffic on one partition), and on-demand pricing at sustained high volume can exceed a right-sized Aurora cluster. Say what you give up, not just what you gain.

**The real-world answer is usually both:** Aurora PostgreSQL for the ledger and anything requiring integrity; DynamoDB for idempotency keys, request de-duplication, session state and high-volume append-only data; and the two connected by an **outbox** so the relational transaction remains the source of truth.

---

## Q32. S3 security?

Layered, because S3 breaches are almost never a flaw in S3 — they are a misconfiguration.

**1. Block Public Access — non-negotiable.** Enable all four settings at the **account** level (`BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, `RestrictPublicBuckets`). This overrides any bucket policy or ACL that would make an object public, so a mistake in a bucket policy cannot expose data. Enforce with an SCP that denies `s3:PutAccountPublicAccessBlock` changes.

**2. Disable ACLs.** Set **Object Ownership = Bucket owner enforced**, which turns ACLs off entirely (the default for buckets created since April 2023). ACLs are a legacy per-object mechanism and the source of a large share of historical exposures. Access should be expressed **only** in policies.

**3. Bucket policy — explicit and conditioned.**
```jsonc
{
  "Statement": [
    { "Sid": "DenyInsecureTransport", "Effect": "Deny", "Principal": "*",
      "Action": "s3:*", "Resource": ["arn:aws:s3:::pay-archive", "arn:aws:s3:::pay-archive/*"],
      "Condition": { "Bool": { "aws:SecureTransport": "false" } } },
    { "Sid": "DenyUnencryptedUploads", "Effect": "Deny", "Principal": "*",
      "Action": "s3:PutObject", "Resource": "arn:aws:s3:::pay-archive/*",
      "Condition": { "StringNotEquals": { "s3:x-amz-server-side-encryption": "aws:kms" } } },
    { "Sid": "OrgOnly", "Effect": "Deny", "Principal": "*", "Action": "s3:*",
      "Resource": "arn:aws:s3:::pay-archive/*",
      "Condition": { "StringNotEquals": { "aws:PrincipalOrgID": "o-abc123" } } }
  ]
}
```
Those three deny statements — TLS required, KMS encryption required, organisation-only — are a good default for any regulated bucket.

**4. Encryption.** SSE-S3 is on by default for all new objects; use **SSE-KMS with a customer-managed key** for regulated data so you own the key policy and get CloudTrail decrypt records. Enable **S3 Bucket Keys** to cut KMS request costs by up to 99 % on high-volume buckets. SSE-C and client-side encryption exist for stricter key-custody mandates.

**5. Private access paths.** **Gateway VPC endpoint** for S3 (free), plus `aws:SourceVpce` conditions in the bucket policy so objects can only be read through your endpoint — an internet-borne credential leak then cannot be used to pull data.

**6. Data protection controls.** **Versioning** (recovers from overwrite/delete, including ransomware), **MFA Delete** on critical buckets, **Object Lock in compliance mode** for WORM retention — which is the specific control regulators expect for immutable audit/regulatory-reporting archives (SEC 17a-4, FINRA, MiFID II record-keeping). Lifecycle policies for retention and cost; **Replication (CRR/SRR)** for DR, with replica-owner separation for ransomware resilience.

**7. Detection.** **CloudTrail data events** for S3 object-level access (off by default — turn them on for sensitive buckets), **Access Analyzer for S3** (finds buckets shared externally), **GuardDuty S3 Protection**, **Macie** for PII/PCI discovery and classification, plus server access logs.

**8. Presigned URLs** for user-facing access: short expiry (minutes), scoped to a single object and method, generated by a service that has already authorised the user. Never hand out long-lived credentials or make a bucket public to serve files; put **CloudFront + OAC** in front for public content.

---

## Q33. SQS vs SNS?

**Per AWS:** SQS *"offers a secure, durable, and available hosted queue that lets you integrate and decouple distributed software systems and components"*; SNS *"is a managed service that provides message delivery from publishers to subscribers"* — a **pub/sub** service.

| | **Amazon SQS** | **Amazon SNS** |
|---|---|---|
| Pattern | **Queue** — point-to-point | **Topic** — publish/subscribe, fan-out |
| Consumers | **One consumer gets each message** | **Every subscriber gets a copy** |
| Model | **Pull** (long polling) | **Push** |
| Persistence | **Up to 14 days** | **No storage** — delivered (with retries) or dropped/DLQ'd |
| Ordering | FIFO queues guarantee it | FIFO topics only |
| Retry / DLQ | Native: visibility timeout, redrive, DLQ | Retry policy per protocol + DLQ per subscription |
| Consumer offline | **Message waits safely** | **Message can be lost** (unless the subscriber is a queue) |
| Subscribers | N/A | SQS, Lambda, HTTP(S), email, SMS, mobile push, Firehose |
| Throughput | Effectively unlimited (FIFO: 300 msg/s, 3,000 batched, or high-throughput mode) | Very high |

**The canonical pattern — say this and the question is answered: SNS + SQS fan-out.**

```
                    ┌──▶ SQS: fraud-check    ──▶ Fraud service
Payment ──▶ SNS ────┼──▶ SQS: ledger-posting ──▶ Ledger service
 topic              ├──▶ SQS: notifications  ──▶ Notification service
                    └──▶ SQS: analytics      ──▶ Firehose ▶ S3
```
Each consumer gets its own durable queue, its own retry policy, its own DLQ, and its own pace. A slow or failed consumer cannot affect the others, and messages survive a consumer being offline for hours. **Subscribing Lambda directly to SNS is the mistake to avoid** for anything that matters: you inherit SNS's retry semantics and lose the durable buffer.

**Choose SQS alone** for work distribution to a pool of workers — one job, one worker, with backpressure.
**Choose SNS alone** only for genuine fire-and-forget notifications (an ops alert, an SMS) where loss is acceptable.
**Choose FIFO on both** when per-key ordering and exactly-once *processing* matter — e.g. `MessageGroupId = accountId` so all events for one account are ordered while different accounts process in parallel. Note the cost: FIFO throughput limits, and the 5-minute deduplication window is not a substitute for your own idempotency.

---

## Q34. SQS vs EventBridge?

| | **Amazon SQS** | **Amazon EventBridge** |
|---|---|---|
| Role | **Buffer / work queue** | **Event bus with routing and filtering** |
| Delivery | Consumer **pulls** | EventBridge **pushes** to targets |
| Routing | None — one queue, one consumer group | **Content-based rules** on the event JSON |
| Targets | Your consumer | **35+ AWS services**, API destinations, cross-account/cross-Region buses |
| Storage | Up to 14 days | None (but **Archive + Replay** is built in) |
| Ordering | FIFO available | **None** |
| Transformation | None | Input transformers |
| Schema | Yours | **Schema Registry** with code binding generation |
| Throughput | Effectively unlimited | Thousands/s (soft limits, raisable) |
| Latency | ms | ~0.5 s typical |
| Cost | $0.40 per million | **$1.00 per million events published** |

**How they compose rather than compete:**

```
Order service ──▶ EventBridge bus ──rule: detail-type = "PaymentCaptured"──▶ SQS ──▶ Settlement worker
                        │
                        ├──rule: source = "aws.rds" (ops events) ──▶ SNS ──▶ on-call
                        └──rule: all ──▶ Firehose ──▶ S3 (audit lake)
```
EventBridge decides **who should hear about this**; SQS gives each consumer a **durable, retryable buffer**. Putting a queue between the bus and the worker is what makes the consumer resilient — EventBridge retries for 24 h but does not hold work for you the way a queue does.

**Choose EventBridge when:** you need content-based routing to several destinations; you're consuming **AWS service events** (RDS failovers, ECS task state, GuardDuty findings, S3 events) — it is the only thing that receives them; you need **SaaS integration** (Stripe, Datadog, Zendesk as partner event sources) or **API destinations** to call an external HTTP endpoint with managed auth and retries; you want a **schema registry** and event **archive/replay** without building them; or you need cross-account/cross-Region event distribution.

**Choose SQS when:** it is work distribution, not event distribution; you need ordering (FIFO); you need long buffering and consumer-controlled pacing; latency and cost matter at very high volume; or you need precise backpressure.

**And choose Kafka/MSK when** you need a **replayable log**, very high sustained throughput, stream processing, and consumers that manage their own offsets over days of history — EventBridge Archive is not an event log, and SQS deletes on consume.

---

## Q35. MSK vs SQS?

**Per AWS:** MSK *"is a fully managed service that enables you to build and run applications that use Apache Kafka to process streaming data"*; SQS is a *"fully managed message queuing service"*. The distinction is **log vs queue** — the same distinction covered in Module 8.

| | **Amazon MSK (Kafka)** | **Amazon SQS** |
|---|---|---|
| Model | **Distributed append-only log** | **Queue** |
| After consumption | **Message remains** until retention expires | **Deleted** |
| **Replay** | **Yes** — reset offsets, re-read history | **No** |
| Multiple consumers | **Yes** — independent consumer groups, independent offsets | One consumer per message (fan-out needs SNS or multiple queues) |
| Ordering | **Per partition**, strong | FIFO queues only |
| Throughput | **Millions/s**, scales with partitions | Very high, but per-message API model |
| Latency | Low ms | Low ms |
| Consumer model | **Pull with offsets**, consumer group rebalancing | Pull with visibility timeout |
| Ops burden | **Real** — brokers, partitions, rebalances, lag, upgrades (MSK Serverless reduces it) | **Near zero** |
| Cost | Broker hours + storage (≈$500+/month for a small production cluster) | **$0.40/million**, zero at idle |
| Stream processing | Kafka Streams, Flink, KSQL | None |

**Choose MSK when:** multiple independent consumers need the same stream; you need **replay** (rebuilding a projection, reprocessing after a bug, seeding a new service — the defining requirement); you need per-key ordering at high volume; you need stream processing (windowed aggregation, joins); throughput is sustained and large (market data, transaction streams, CDC); or you are doing event sourcing where the log *is* the source of truth.

**Choose SQS when:** it is a work queue; each message has exactly one consumer; you want zero operational burden; volume is spiky or modest; and you would rather spend nothing at idle. SQS + Lambda is a complete, production-grade, near-zero-ops processing pipeline.

**The judgement call that matters in an interview:** Kafka is chosen far more often than it is needed. It is a distributed system you must operate, and the honest cost is a team that understands partitions, consumer lag, rebalancing and retention — not just a monthly bill. If the requirement is "process each payment once, reliably, with retries and a DLQ", **SQS is the correct answer** and saying so demonstrates better judgement than reaching for Kafka. If the requirement is "the ledger, the fraud engine, the analytics lake and a future service must all see every transaction, and I must be able to replay yesterday", that is Kafka, and no queue substitutes for it.

**Middle ground worth naming:** **Amazon Kinesis Data Streams** gives log semantics with replay and much lower operational burden than self-managed Kafka, and **MSK Serverless** removes broker sizing while keeping the Kafka API and the wider ecosystem.

---

## Q36. ALB vs NLB?

**Per the ELB documentation:** *"An Application Load Balancer functions at the application layer, the seventh layer of the Open Systems Interconnection (OSI) model."* *"A Network Load Balancer functions at the fourth layer of the OSI model. It can handle millions of requests per second."*

| | **Application Load Balancer (L7)** | **Network Load Balancer (L4)** |
|---|---|---|
| Protocols | HTTP, HTTPS, gRPC, HTTP/2, WebSocket | TCP, UDP, TLS, TCP_UDP, and **QUIC / TCP_QUIC** |
| Routing | **Content-based** — path, host, HTTP header, HTTP method, query string, source IP | **Flow hash** (protocol, source IP/port, dest IP/port, and TCP sequence number) |
| Routing algorithm | Round robin (default) or **least outstanding requests** | Flow hash; a connection stays pinned to one target for its lifetime |
| **IP address** | Dynamic — DNS name only | **Static IP per AZ**, and optionally **one Elastic IP per subnet** |
| Performance | Very high | **Millions of requests/s**, ultra-low latency |
| TLS | Terminates; ACM integration | Terminates **or** passes through end-to-end |
| Client IP | Passed in `X-Forwarded-For` | **Preserved at the packet level** (target type dependent) |
| Targets | Instance, IP, **Lambda** | Instance, IP, **an Application Load Balancer** |
| Extra L7 features | Redirects, fixed responses, **user authentication (OIDC/Cognito)**, WAF integration, sticky sessions | None (it doesn't see HTTP) |
| **AWS WAF** | **Supported** | **Not supported** (WAF is HTTP-layer) |
| PrivateLink endpoint service | No | **Yes** — this is why NLB is the PrivateLink front door |

**Decision rule:**

- **ALB** for anything HTTP — REST APIs, web apps, microservices behind path/host routing, gRPC services, ECS/EKS ingress. It is the default for a .NET microservices platform, and the only one of the two that WAF can protect.
- **NLB** when you need a **static IP or Elastic IP** (third-party firewall allow-listing — extremely common in financial integrations where the counterparty allow-lists your IPs), **non-HTTP protocols** (FIX over TCP, SMTP, DNS, custom binary protocols), **TLS pass-through** to the application for end-to-end encryption or mTLS terminated by your own service, **extreme throughput/latency sensitivity**, or a **PrivateLink endpoint service**.

**The pattern worth naming: NLB in front of ALB.** ALB is a target type for NLB, so you can get static/Elastic IPs *and* L7 routing. Cost is two load balancers and an extra hop; the reason you would do it is an external counterparty that requires fixed IPs while your platform still needs host/path routing and WAF. Say that explicitly — it is a real production pattern, not a trick.

**Also in this family:** the **Gateway Load Balancer** (L3, for inserting third-party virtual appliances/firewalls transparently via GENEVE) and the **Classic Load Balancer**, which AWS documents as previous-generation with a recommendation to migrate — do not propose CLB for anything new.

---

## Q37. API Gateway vs ALB?

**Per AWS:** *"Amazon API Gateway is an AWS service for creating, publishing, maintaining, monitoring, and securing REST, HTTP, and WebSocket APIs at any scale... API Gateway acts as a 'front door' for applications to access data, business logic, or functionality from your backend services."* An ALB, by contrast, is a load balancer — it distributes traffic; it does not manage an API.

| | **API Gateway** | **Application Load Balancer** |
|---|---|---|
| Role | **API management front door** | **Load balancing** |
| Built-in auth | **IAM, Cognito user pools, Lambda authorizers**, JWT authorizers (HTTP APIs) | OIDC/Cognito authentication action only |
| **Throttling / quotas** | **Yes** — per-stage, per-method, per API key usage plans | No (WAF rate-based rules only) |
| Request/response transformation | **Yes** (REST APIs — mapping templates) | No |
| Caching | **Yes** (REST APIs, per stage) | No |
| Versioning / stages | **Yes** — stages, canary releases | No |
| API keys, usage plans, developer portal | **Yes** | No |
| Validation | **Request validation against a schema** | No |
| Targets | Lambda, HTTP endpoints, **any AWS service directly**, VPC links to NLB/ALB | Instances, IPs, Lambda |
| WebSocket | **Yes**, managed, stateful | Passes WebSocket through, but you manage state |
| Latency added | ~10–30 ms | ~1–3 ms |
| **Cost** | **REST $3.50/million** requests; **HTTP API $1.00/million** | ~$16/month + **LCU** hours — dramatically cheaper at high volume |
| Scale to zero | **Yes** | No — you pay hourly |

**The cost crossover is the practical heart of this question.** At 100 million requests/month: REST API ≈ $350, HTTP API ≈ $100, ALB ≈ $20–40. At 1 million/month the ALB's fixed hourly charge makes API Gateway cheaper. Do the arithmetic out loud in an interview — it is exactly the kind of reasoning the role is being hired for.

**Choose API Gateway when:** you are exposing APIs to **external consumers or partners** (usage plans, API keys, per-consumer throttling, documentation are the product); you need Lambda as the backend without running a load balancer; you need request validation, transformation or WebSocket management; traffic is spiky and you want to pay nothing at idle; or you want managed canary deployments per stage.

**Choose ALB when:** the consumers are internal services or your own front end; traffic is high and sustained (cost); latency budget is tight; you are routing to ECS/EKS/EC2 with host and path rules; or you need L7 features on non-API HTTP traffic.

**The pattern in a real fintech platform:** **CloudFront → WAF → API Gateway** for the public, partner-facing API (throttling, keys, per-partner quotas, mTLS on a custom domain for the payment-partner channel), and **internal ALB** for east-west and internal front-end traffic. And note that HTTP APIs — cheaper, lower-latency, JWT authorizers — are the right default for a new API unless you specifically need REST-API features (mapping templates, caching, API keys, WAF on the API itself, private APIs).

---

## Q38. CloudFront?

**Per AWS:** *"Amazon CloudFront is a web service that speeds up distribution of your static and dynamic web content... CloudFront delivers your content through a worldwide network of data centers called edge locations. When a user requests content that you're serving with CloudFront, the request is routed to the edge location that provides the lowest latency."*

**How it works:** you define one or more **origins** (S3, ALB, API Gateway, MediaPackage, or any custom HTTP server) and a **distribution**. Requests land at the nearest **edge location (PoP)**; a cache hit is served immediately, a miss goes through a **regional edge cache** and then to the origin over the AWS backbone. Default object TTL is 24 hours unless the origin sets cache headers.

**Why an architect uses it — and only the first of these is about caching:**

| Benefit | Mechanism |
|---|---|
| **Latency** | Content served from ~600 PoPs; requests ride the **AWS backbone** rather than the public internet, which helps **dynamic, uncacheable** traffic too |
| **Origin offload** | Cache hits never reach your origin — the cheapest scaling you will ever do |
| **Cost** | **Origin→CloudFront data transfer is free from S3, ELB and API Gateway**; CloudFront egress is cheaper than direct EC2/S3 egress |
| **Security** | **AWS Shield Standard included free**, WAF attachment, TLS termination at the edge, **OAC** to keep S3 private, signed URLs/cookies, geo-restriction |
| **Availability** | **Origin failover** to a secondary origin per request |
| **Customisation** | **CloudFront Functions** (sub-ms, edge, for header rewrites, redirects, A/B, auth token checks) and **Lambda@Edge** (heavier, regional edge, full runtime) |

**Key configuration decisions:**

- **Cache key design** — by default CloudFront caches on the URL; adding headers, cookies or query strings to the cache key multiplies cache entries and destroys hit rate. Use **cache policies** and **origin request policies** to send what the origin needs *without* putting it in the cache key. This is the single most impactful CloudFront tuning knob.
- **Origin Access Control (OAC)** — the current mechanism (superseding OAI) for letting *only* CloudFront read a private S3 bucket. The bucket stays fully private; there is no public object anywhere.
- **Invalidation vs versioned filenames** — invalidations are slow and metered; content-hashed filenames (`app.9f2c1a.js`) are the correct pattern.
- **HTTPS, TLS 1.2+ minimum, HTTP/2 and HTTP/3**, and ACM certificates issued in **us-east-1** for CloudFront (a detail that catches people out).

**In a fintech context:** CloudFront fronts the customer web/mobile channel — static assets and API calls both — with WAF attached, Shield Standard (or Advanced for a high-profile brand), geo-restriction where licensing demands it, and **signed URLs** for time-limited access to generated statements or documents in a private S3 bucket. Note also that a payment page delivered through CloudFront is in PCI scope; CloudFront is a PCI DSS-eligible service, but the scoping analysis is yours.

---

## Q39. WAF?

**Per AWS:** *"AWS WAF is a web application firewall that lets you monitor the HTTP and HTTPS requests that are forwarded to your protected web application resources."* Protected resource types are, per the docs: **CloudFront distribution, API Gateway REST API, Application Load Balancer, AppSync GraphQL API, Cognito user pool, App Runner service, Amazon Bedrock AgentCore Gateway, AWS Verified Access instance, and AWS Amplify** — note that **NLB is not on the list**, because WAF operates on HTTP.

**Structure:** a **web ACL** contains **rules** (or **rule groups**) evaluated in priority order. Each rule has a **statement** (what to match) and an **action**.

**Actions, per the documentation:** `Allow`, `Block`, **`Count`** (observe without affecting traffic), and **`CAPTCHA` / `Challenge`** (silent browser challenge) for bot mitigation.

**Match criteria AWS lists:** originating IP addresses, originating country, values in request headers, specific strings or **regex** patterns anywhere in the request, request **length**, presence of likely **SQL injection**, and presence of likely **cross-site scripting**.

**What you actually deploy, in order:**

| Layer | Content |
|---|---|
| **AWS Managed Rules** | `AWSManagedRulesCommonRuleSet` (OWASP-style baseline), `KnownBadInputs`, `SQLiRuleSet`, `LinuxRuleSet`/`WindowsRuleSet`, `AmazonIpReputationList`, `AnonymousIpList` |
| **Rate-based rules** | Block a source IP exceeding N requests in a 5-minute (or 1-minute) window — your primary L7 DDoS and brute-force control; scope it to `/login`, `/payments` etc. rather than globally |
| **Custom rules** | Geo-blocking, allow-listing partner CIDRs, header/JWT-shape checks, size constraints on request bodies |
| **Bot Control** | Managed detection and categorisation of bots — verified crawlers vs automated abuse |
| **Fraud Control / Account Takeover Prevention (ATP)** and **Account Creation Fraud Prevention (ACFP)** | Credential-stuffing and fake-signup defence — directly relevant to a bank's login and onboarding flows |
| **Logging** | Full request logs to CloudWatch Logs, S3 or Firehose, with field redaction for sensitive headers |

**The operational discipline that separates practitioners from readers:** **always deploy new rules in `Count` mode first**, watch the sampled requests and CloudWatch metrics for false positives, then flip to `Block`. A WAF rule that blocks legitimate payment traffic is a production incident, and the documentation explicitly frames `Count` as the mechanism for validating configuration before enforcing it.

**Related services to name for completeness:** **AWS Shield Standard** (free, automatic L3/L4 DDoS protection), **Shield Advanced** (paid — L7 automatic mitigation, cost-protection credits, and the **Shield Response Team**), and **AWS Firewall Manager**, which applies WAF/Shield/security-group/Network Firewall/DNS Firewall policies **centrally across all accounts in an Organization, including new ones automatically** — that last point is the one that matters in a multi-account bank.

---

## Q40. CloudWatch?

**Per AWS:** *"Amazon CloudWatch monitors your Amazon Web Services (AWS) resources and the applications you run on AWS in real time, and offers many tools to give you system-wide observability of your application performance, operational health, and resource utilization."*

**The components, and what each is for:**

| Component | Purpose |
|---|---|
| **Metrics** | Time-series data at user-defined intervals; AWS services publish automatically, and you publish custom metrics via **OTLP (OpenTelemetry)** or `PutMetricData` |
| **Alarms** | Continuously evaluate a metric (or a **metric math** expression, or an **anomaly detection** band) against a threshold; trigger SNS, Auto Scaling, EC2 or Systems Manager actions. **Composite alarms** combine several alarms to cut noise |
| **Dashboards** | Cross-account, cross-Region views; curated automatic dashboards exist for many services |
| **Logs** | Log groups/streams, **Logs Insights** queries (three query languages, including SQL and PPL), **metric filters** (turn a log pattern into a metric you can alarm on), **subscription filters** (stream to Firehose/Lambda/OpenSearch), and **log anomaly detection** |
| **Application Signals** | APM — automatic latency/error/request-rate monitoring and **SLOs with error budgets**, without manual instrumentation |
| **Synthetics (canaries)** | Scripted probes of endpoints/APIs that detect failure **before real users do** |
| **RUM** | Real user monitoring from the browser |
| **Container Insights / Lambda Insights / Database Insights** | Infrastructure-level depth for ECS/EKS, Lambda (incl. cold starts) and databases |
| **Cross-account observability** | A central monitoring account viewing metrics, logs and traces from every source account — the standard enterprise pattern |
| **OpenTelemetry / OTLP endpoints** | Native OTLP ingest and PromQL querying — the vendor-neutral path, and what I would standardise on for a new platform |

**What I would tell a panel about using it well:**

- **Alarm on symptoms, not causes.** Alarm on p99 latency, error rate and SLO burn rate — not on CPU. CPU rarely maps to customer pain; a burn-rate alarm does.
- **Metric filters turn logs into signal.** A structured log line with `"event":"PaymentDeclined"` becomes a metric and therefore an alarm, without new code.
- **Cost is a real design concern.** Custom metrics are $0.30 each per month; a metric per customer or per instance ID explodes cardinality and bill alike. Use dimensions deliberately, use **embedded metric format (EMF)** to emit metrics from logs, and set log-group retention (the default is *never expire*, which is a silent, permanent cost).
- **CloudWatch is one leg of the tripod.** Metrics (CloudWatch) + logs (CloudWatch Logs/OpenSearch) + **traces (X-Ray or an OTel backend)**, correlated by a trace/correlation ID. Without the third leg you cannot answer "which of the eleven services made this payment slow?"

---

## Q41. CloudTrail?

**Per AWS:** *"AWS CloudTrail is an AWS service that helps you enable operational and risk auditing, governance, and compliance of your AWS account. Actions taken by a user, role, or an AWS service are recorded as events in CloudTrail. Events include actions taken in the AWS Management Console, AWS Command Line Interface, and AWS SDKs and APIs."*

**Three ways CloudTrail records events, per the documentation:**

| Mechanism | What it gives you |
|---|---|
| **Event history** | *"A viewable, searchable, downloadable, and immutable record of the past **90 days** of management events in an AWS Region."* Automatic, free, single-attribute filtering — **and 90 days is nowhere near a regulatory retention period** |
| **Trails** | Deliver events to **S3** (and optionally CloudWatch Logs and EventBridge) for long-term retention and analysis. One copy of ongoing management events per account is free; S3 storage is charged |
| **CloudTrail Lake** | A managed, immutable data lake — events converted to **Apache ORC** columnar format in **event data stores**, retained up to **3,653 days (~10 years)** on the one-year-extendable pricing option, queryable with SQL, and able to ingest events from outside AWS |

**Event types to distinguish — a common interview probe:**

- **Management events** (control plane: `RunInstances`, `CreateUser`, `PutBucketPolicy`) — logged by default.
- **Data events** (data plane: `s3:GetObject`, `lambda:Invoke`, DynamoDB item operations) — **not logged by default**, high volume, chargeable. Enable them selectively on sensitive buckets and tables; in a fintech, on anything holding PII or card data.
- **Network activity events** — VPC endpoint activity.
- **Insights events** — automatic anomaly detection on API **call-rate and error-rate** patterns.

**How I configure it in a regulated environment:**

- An **organisation trail** created in the management account, covering **all accounts and all Regions**, that member accounts cannot disable.
- Delivered to a **dedicated log-archive account** with a bucket the workload accounts cannot write to or delete from, **Object Lock in compliance mode**, versioning, and **SSE-KMS**.
- **Log file validation enabled** — CloudTrail writes signed digest files so you can prove logs were not tampered with. Auditors ask for this specifically.
- Delivery to **CloudWatch Logs** for metric filters and alarms on the events that matter: root account usage, `ConsoleLogin` without MFA, IAM policy changes, security-group and route-table changes, `StopLogging`, `DeleteTrail`, `ScheduleKeyDeletion`, and Config recorder changes.
- An **SCP** denying `cloudtrail:StopLogging`/`DeleteTrail` organisation-wide.

**The one-line distinction to have ready:** *CloudTrail tells you **who did what** to the AWS control plane; CloudWatch tells you **how the system is behaving**; VPC Flow Logs tell you **what talked to what**.* An investigation needs all three, correlated by time and principal.

---

## Q42. GuardDuty?

**Per AWS:** *"Amazon GuardDuty is a threat detection service that continuously monitors, analyzes, and processes AWS data sources and logs in your AWS environment. GuardDuty uses threat intelligence feeds, such as lists of malicious IP addresses and domains, file hashes, and machine learning (ML) models to identify suspicious and potentially malicious activity."*

**Foundational data sources — enabled automatically, and requiring no configuration by you:** **CloudTrail management events, VPC Flow Logs, and DNS logs**. GuardDuty reads these out of band; you do not have to enable Flow Logs or pay for their delivery for GuardDuty to analyse them.

**Optional protection plans** (each priced separately) extend coverage to: **EKS audit logs**, **RDS login activity**, **S3 data events in CloudTrail**, **EBS volumes (Malware Protection)**, **Runtime Monitoring** across EKS/EC2/ECS-Fargate, **Lambda network activity logs**, and **AI Protection** over Bedrock/SageMaker CloudTrail data events.

**Newer capabilities worth knowing, because they change how you triage:**

- **Extended Threat Detection** — correlates individually-innocuous events into an **attack sequence** finding spanning data sources, resources and time. Enabled automatically, at no extra cost.
- **Custom Detection Rules** — a curated library of rules aligned to threat-actor techniques, evaluated over CloudTrail management events.
- **GuardDuty Investigation (preview)** — AI-assisted analysis of findings with risk scoring and **MITRE ATT&CK** classification.

**What it actually detects, in the terms AWS uses:** compromised and exfiltrated credentials; data exfiltration/destruction indicative of ransomware; anomalous Aurora/RDS login patterns; unauthorised cryptomining; malware on EC2, container workloads and newly uploaded S3 objects; and OS-level, network and file events indicating unauthorised behaviour in EKS/ECS-Fargate/EC2.

**How it fits the wider detection stack:**

```
CloudTrail ─┐
VPC Flow    ├─▶ GuardDuty ─▶ findings ─▶ EventBridge ─┬─▶ Security Hub CSPM (aggregate, prioritise)
DNS logs   ─┘                                         ├─▶ SNS / Slack / PagerDuty
                                                      ├─▶ Lambda / SSM (auto-remediate: isolate SG,
                                                      │      revoke sessions, snapshot for forensics)
                                                      └─▶ Amazon Detective (graph-based investigation)
```

**Enterprise configuration:** enable via **AWS Organizations** with a **delegated administrator** in the security account, auto-enable for new accounts, in **every Region** — including Regions you don't use, because that is precisely where cryptomining and unauthorised activity shows up unnoticed. Route findings to EventBridge with severity-based handling (high → page, medium → ticket, low → dashboard). Do **not** wire automatic termination of production resources to a finding; auto-isolate and snapshot, then let a human decide.

---

## Q43. How do you design HA architecture across AZs?

**The Well-Architected Reliability pillar's premise:** design for failure and assume every component will eventually fail. Multi-AZ is the primary in-Region mechanism for that.

**Principles, then the concrete architecture.**

1. **No single-AZ dependency anywhere in the request path.** Including the ones people forget: NAT Gateway (Q9), a self-managed instance, a single Redis node, an EBS volume, a licence server.
2. **N+1 capacity minimum.** With three AZs, each must run at ≥50 % of peak so two can absorb the load — *statically stable*: capacity is already provisioned rather than depending on a control-plane scaling action during the failure. The DR whitepaper makes this point explicitly: *"for maximum resiliency, you should use only data plane operations as part of your failover operation"*, because **data planes have higher availability design goals than control planes**. Depending on Auto Scaling to save you *during* an AZ failure is a control-plane dependency.
3. **Health checks must be real.** A `/health` that returns 200 whenever the process is alive tells you nothing. It must verify the dependencies the request path needs — and a *deep* health check must not cascade (if the DB is briefly slow, do not mark every instance unhealthy and remove all capacity).
4. **Automate failover and remove humans from the path.** ALB target de-registration, ASG replacement, RDS Multi-AZ failover, and Route 53 health checks all act without a person.
5. **Design for graceful degradation.** If fraud scoring is down, do payments queue or fail? Decide deliberately, per business rule, and implement it (circuit breaker + fallback).

**Reference architecture:**

```
                      Route 53 (health checks, failover/latency routing)
                                     │
                              CloudFront + WAF
                                     │
                    ALB (3 AZs, cross-zone load balancing on)
             ┌───────────────┬───────────────┬───────────────┐
        AZ-a │ ECS/EKS tasks │ AZ-b tasks    │ AZ-c tasks    │  ← min 2 per AZ, ≥50% headroom
             │ NAT-a         │ NAT-b         │ NAT-c         │  ← one per AZ
             └───────────────┴───────────────┴───────────────┘
                     │                │               │
             Aurora writer (AZ-a) ⇄ reader (AZ-b) ⇄ reader (AZ-c)   ← Multi-AZ, auto failover
             ElastiCache with Multi-AZ + automatic failover
             SQS / SNS / S3 / DynamoDB — regionally redundant by design
```

**Design details that make it actually work:**

- **Enable cross-zone load balancing** (on by default for ALB; off by default and charged for NLB) so one AZ's failure doesn't leave a third of clients hitting dead nodes.
- **Spread ASG/ECS/EKS placement across AZs** (`Multi-AZ` ASG, ECS `spread` placement strategy, K8s `topologySpreadConstraints` and pod anti-affinity). Three replicas that all land in one AZ is a very common real-world defect.
- **Choose managed, regionally-redundant services** wherever possible — S3, DynamoDB, SQS, SNS, Lambda are multi-AZ by construction and are the cheapest availability you can buy.
- **Watch cross-AZ data-transfer cost** and accept it: it is the price of the design. Optimise chatty paths (caching, co-located reads) rather than collapsing to one AZ.
- **Test it.** **AWS Fault Injection Service** has an AZ-availability-power-interruption experiment; a **game day** that actually removes an AZ is the only evidence the design works. An untested HA design is a hypothesis.

**Where the failure usually is in practice:** not the compute tier, which everyone gets right — it is the single NAT Gateway, the single Redis node, a stateful service holding session in memory, a hard-coded AZ in a Terraform module, or a health check that lies.

---

## Q44. Explain AWS disaster recovery strategies.

**Per the AWS whitepaper *Disaster Recovery of Workloads on AWS*:** *"Disaster recovery strategies available to you within AWS can be broadly categorized into four approaches, ranging from the low cost and low complexity of making backups to more complex strategies using multiple active Regions."*

| Strategy | What runs in the DR Region | RTO | RPO | Relative cost |
|---|---|---|---|---|
| **Backup & restore** | Nothing — backups only; redeploy from IaC at failover | **Hours** | **Hours** | **$** |
| **Pilot light** | Data replicated continuously; core infrastructure deployed but application servers **switched off** | **10s of minutes** | **Minutes** (near-zero with continuous replication) | **$$** |
| **Warm standby** | A **scaled-down but fully functional** copy, always running and able to take traffic immediately | **Minutes** | **Seconds** | **$$$** |
| **Multi-site active/active** (and hot standby) | Full capacity, serving traffic in all Regions | **Near zero** | **Near zero** | **$$$$** |

**AWS's own clarification of the pair people confuse:** *"pilot light cannot process requests without additional action taken first, whereas warm standby can handle traffic (at reduced capacity levels) immediately. The pilot light approach requires you to 'turn on' servers... whereas warm standby only requires you to scale up."*

**Cross-cutting points the whitepaper makes, and which are what a Principal-level answer contains:**

- **Use data-plane operations for failover, not control-plane.** Route 53 health checks and **Amazon Application Recovery Controller (ARC)** routing controls are data-plane; changing Route 53 weights or relying on Auto Scaling to scale the DR Region are control-plane and therefore less resilient. AWS says this explicitly.
- **Automatic failover should be used with caution.** *"If you fail over when you don't need to (false alarm), then you incur those losses. Manually initiated failover is therefore often used"* — but every step should be automated so the manual part is a single button.
- **Replication is not backup.** Continuous replication propagates corruption and malicious deletion faithfully. You need **point-in-time backups and versioning** alongside replication. This is the ransomware answer.
- **Deploy DR infrastructure as code** (CloudFormation/CDK/StackSets) so the recovery Region is provably identical, and use **separate accounts per Region** so a credential compromise doesn't take both.
- **Statically stable is safer than elastic** in a DR Region: pre-provisioned capacity (hot standby) removes a dependency on scaling control planes during the very event that stresses them. And check **service quotas** in the DR Region — a quota that blocks scale-up at failover is a classic, embarrassing failure.
- **Multi-Region write strategies**, per the whitepaper: **write global** (all writes to one Region — Aurora Global Database, promotable in under a minute, with write forwarding), **write local** (DynamoDB Global Tables, **last-writer-wins** conflict resolution), or **write partitioned** (writes routed by partition key to avoid conflict). Naming which one you would choose — and that a ledger cannot tolerate last-writer-wins — is the answer that separates candidates.
- **Test it.** *"It is critical to regularly assess and test your disaster recovery strategy."* Use **AWS Resilience Hub** to validate that the design actually meets the stated RTO/RPO, and run DR game days. In banking this is not optional — **DORA** and equivalent regimes require evidenced, periodic recovery testing.

**How I'd choose:** start from the business impact analysis, not the technology. Tier the workloads — the payment authorisation path and the ledger get warm standby or active/active; batch reporting and internal tooling get backup-and-restore. Paying for active/active across an entire estate is a failure of prioritisation, not a display of rigour.

---

## Q45. Explain RPO and RTO.

**Per the Well-Architected Reliability pillar, verbatim:**

> **Recovery Time Objective (RTO)** — *"Defined by the organization. RTO is the maximum acceptable delay between the interruption of service and restoration of service. This determines what is considered an acceptable time window when service is unavailable."*
>
> **Recovery Point Objective (RPO)** — *"Defined by the organization. RPO is the maximum acceptable amount of time since the last data recovery point. This determines what is considered an acceptable loss of data between the last recovery point and the interruption of service."*

```
        RPO  ◀─── acceptable data loss ───▶│              │◀── acceptable downtime ──▶  RTO
   ─────●──────────────────────────────────╳──────────────────────────────────────●─────▶ time
   last recovery point                  DISASTER                          service restored
```

**RTO is about time; RPO is about data.** Both are **business decisions**, not engineering ones — AWS's definitions say "defined by the organization" twice, and that phrase is the point. The architect's job is to translate them into a strategy and a cost, and to push back when the stated numbers ("zero and zero, obviously") aren't backed by willingness to pay.

**Two distinctions worth making unprompted:**

- **RTO ≠ MTTR.** Per AWS: *"MTTR is a mean value taken over several availability impacting events over a period of time, while RTO is a target, or maximum value allowed, for a single availability impacting event."*
- **RTO/RPO ≠ availability.** Availability is mean resiliency over time against component failures; DR objectives are one-time recovery targets for a disaster.

**How each maps to technology:**

| RPO target | Mechanism |
|---|---|
| 24 h | Nightly snapshots |
| 1 h | Hourly snapshots + transaction-log shipping |
| Minutes | Continuous async replication — cross-Region read replica, S3 CRR, DynamoDB Global Tables |
| Seconds | Aurora Global Database (typical replication latency **under a second**) |
| **Zero** | Synchronous replication — in practice this bounds you to Multi-AZ within a Region, because synchronous cross-Region writes cost latency on every transaction |

| RTO target | Strategy |
|---|---|
| Hours–days | Backup & restore |
| ~10s of minutes | Pilot light |
| Minutes | Warm standby |
| Near zero | Multi-site active/active |

**The conversation to have with the business** (and saying you would have it is the mark of a Principal-level answer): "Zero RPO across Regions means synchronous cross-Region commits — that adds tens of milliseconds to every payment and reduces availability, because a write now depends on two Regions. Would you rather have 5 seconds of RPO and a faster, more available system?" Then tier it: **the ledger might warrant RPO ≈ 0 within a Region and seconds cross-Region; the reporting warehouse can lose a day.** A single organisation-wide RTO/RPO is always the wrong answer.

**Finally, prove the numbers.** An untested RTO is a guess. Run recovery drills, measure the actual elapsed time, and record it — that measurement, not the design document, is what a regulator and an incident review both ask for.

---

## Q46. How would you design a fintech platform on AWS?

A complete answer moves through **landing zone → network → compute → data → integration → security → observability → resilience → cost**, and keeps naming the regulatory constraint that drives each choice.

**1. Account structure (AWS Organizations + Control Tower).** Separate accounts are the strongest blast-radius and compliance boundary AWS offers:

```
Root ── Organizations, SCPs
 ├── Security OU:     log-archive (immutable CloudTrail/Config, Object Lock)
 │                    security-tooling (GuardDuty/Security Hub/Detective delegated admin)
 ├── Infrastructure:  network (TGW, egress VPC, inspection VPC), shared-services (CI/CD, IPAM)
 ├── Workloads-Prod:  payments-prod, ledger-prod, customer-prod   ← PCI/regulated scope isolated
 ├── Workloads-NonProd: dev, test, uat  (never routable to prod)
 └── Sandbox
```
**SCPs** deny: Regions outside the approved list (data residency), disabling CloudTrail/Config/GuardDuty, `iam:CreateAccessKey`, making S3 buckets public, deleting KMS keys, and root usage.

**2. Network.** Three-tier VPCs per workload account (public/private/isolated), **Transit Gateway** with segmented route tables (prod / non-prod / shared / inspection), **per-AZ NAT** (Q9), **centralised egress with AWS Network Firewall** for domain-based egress filtering, **PrivateLink** for every AWS service and every partner integration, Direct Connect (plus VPN backup) to the data centre, and **central IPAM** so nothing ever overlaps.

**3. Compute.** **EKS or ECS on Fargate** for the .NET microservices — Fargate removes node patching from PCI scope, which is a genuine compliance saving. Lambda for event glue and scheduled work. Deployment via **GitOps (Argo CD)** or CodePipeline with **immutable, signed images**, ECR scanning, and blue/green or canary rollouts.

**4. Data — pick per workload, not per fashion.**

| Store | Use |
|---|---|
| **Aurora PostgreSQL** (Multi-AZ; Global Database for DR) | **The ledger, accounts, positions** — ACID, constraints, correctness |
| **DynamoDB** | Idempotency keys, request de-duplication, session/state, high-volume append-only data |
| **MSK / Kinesis** | Transaction event stream — replayable log feeding fraud, ledger, analytics |
| **ElastiCache (Redis)** | Reference data, rate limiting, hot reads — never the source of truth |
| **S3 + Glue/Athena/Lake Formation** | Data lake, regulatory reporting, archive with **Object Lock (WORM)** for record-keeping rules |
| **OpenSearch** | Log/search analytics |

**5. Transaction integrity — the part a fintech panel is really testing.** **Transactional outbox** so the database write and the event publish cannot diverge; **Saga with compensations** across services (payments have no distributed rollback); **idempotency keys** on every external-facing mutation, stored in DynamoDB with a TTL; **exactly-once business processing = at-least-once delivery + at-most-once effect**, achieved by dedupe on the consumer side; and **daily reconciliation** against the provider's settlement file, with breaks classified into auto-resolvable / manual / investigate. Reconciliation is mandatory even when the counterparty claims idempotency.

**6. Security.** IAM roles everywhere (IRSA/task roles/OIDC for CI), **KMS CMKs** per data domain with key policies and rotation, **Secrets Manager** with automatic rotation, TLS 1.2+ everywhere and **mTLS service-to-service** (App Mesh/Istio or ALB mTLS), **CloudFront + WAF + Shield** on the edge, tokenisation/vaulting of PAN so cardholder data never lands in your own stores, field-level encryption for PII, and **Macie** to detect PII that leaks into the wrong bucket anyway.

**7. Observability.** OpenTelemetry instrumentation → CloudWatch (metrics/logs) + X-Ray or an OTel backend for traces, **correlation ID propagated end to end and stamped on every log line**, business-level dashboards (authorisation rate, settlement lag, reconciliation breaks) alongside technical ones, **SLOs with burn-rate alerts**, and **Synthetics canaries** on the payment path. Cross-account observability into a central monitoring account.

**8. Resilience.** Multi-AZ everywhere as the baseline; **warm standby in a second Region** for the payment path with Aurora Global Database (RPO seconds, RTO minutes) and backup-and-restore for everything non-critical; **Amazon Application Recovery Controller** routing controls for data-plane failover; **AWS Backup** with cross-account, cross-Region copies and **Vault Lock**; documented, *tested* runbooks and quarterly DR game days with **Fault Injection Service**.

**9. Compliance and evidence.** Organisation CloudTrail with log-file validation into the locked log-archive account; **AWS Config** conformance packs (PCI DSS, CIS) with auto-remediation; **Security Hub CSPM** as the aggregation point; **Audit Manager** to assemble evidence; **Artifact** for AWS's own attestations. Change management: everything through IaC and pull request, with separation of duties between the person who writes and the person who approves, and **no standing human write access to production**.

**10. Cost.** Savings Plans/Reserved Instances for the steady baseline, Graviton where the runtime supports it (typically 20–40 % better price/performance for .NET on ARM64), S3 lifecycle policies to Glacier for archives, VPC endpoints to cut NAT charges, cost allocation tags enforced by SCP, and per-team budgets with anomaly detection.

**Closing framing to say out loud:** in this domain, **correctness, auditability and recoverability rank above throughput**. Most payment systems are not throughput-bound — a few hundred TPS is unremarkable for AWS — but they are unforgiving about a lost, duplicated or unexplainable transaction. Design the platform so that every money movement is idempotent, traceable end to end, reconcilable against an external source of truth, and recoverable to a known point in time. Everything above exists to serve that.

---

## References — official documentation

| Topic | Source |
|---|---|
| AWS Global Infrastructure (Regions, AZs, Local Zones) | https://aws.amazon.com/about-aws/global-infrastructure/ |
| Regions and Availability Zones concepts | https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-regions-availability-zones.html |
| Amazon VPC User Guide | https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html |
| VPC subnets and reserved IP addresses | https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html |
| VPC route tables | https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html |
| Internet gateways | https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html |
| NAT gateways (incl. per-AZ guidance, connection limits) | https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html |
| Security groups | https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html |
| Network ACLs | https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html |
| VPC peering (incl. non-transitivity, CIDR overlap) | https://docs.aws.amazon.com/vpc/latest/peering/what-is-vpc-peering.html |
| VPC peering — unsupported configurations | https://docs.aws.amazon.com/vpc/latest/peering/invalid-peering-configurations.html |
| AWS Transit Gateway | https://docs.aws.amazon.com/vpc/latest/tgw/what-is-transit-gateway.html |
| AWS PrivateLink | https://docs.aws.amazon.com/vpc/latest/privatelink/what-is-privatelink.html |
| VPC Reachability Analyzer | https://docs.aws.amazon.com/vpc/latest/reachability/what-is-reachability-analyzer.html |
| VPC Flow Logs | https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html |
| Amazon VPC IP Address Manager (IPAM) | https://docs.aws.amazon.com/vpc/latest/ipam/what-it-is-ipam.html |
| AWS Network Firewall | https://docs.aws.amazon.com/network-firewall/latest/developerguide/what-is-aws-network-firewall.html |
| IAM User Guide | https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html |
| IAM policy evaluation logic | https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html |
| IAM roles | https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html |
| IAM Access Analyzer | https://docs.aws.amazon.com/IAM/latest/UserGuide/what-is-access-analyzer.html |
| Confused-deputy prevention (`aws:SourceArn`) | https://docs.aws.amazon.com/IAM/latest/UserGuide/confused-deputy.html |
| Service control policies (Organizations) | https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html |
| AWS KMS Developer Guide | https://docs.aws.amazon.com/kms/latest/developerguide/overview.html |
| KMS envelope encryption | https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#enveloping |
| KMS multi-Region keys | https://docs.aws.amazon.com/kms/latest/developerguide/multi-region-keys-overview.html |
| AWS Secrets Manager | https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html |
| Secrets Manager rotation | https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html |
| SSM Parameter Store | https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html |
| Amazon EC2 | https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html |
| Amazon ECS Developer Guide | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/Welcome.html |
| Amazon EKS User Guide | https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html |
| AWS Fargate | https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html |
| AWS Lambda Developer Guide | https://docs.aws.amazon.com/lambda/latest/dg/welcome.html |
| Amazon RDS User Guide | https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html |
| RDS Multi-AZ deployments | https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html |
| RDS read replicas | https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html |
| Amazon Aurora Global Database | https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-global-database.html |
| Amazon DynamoDB Developer Guide | https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html |
| DynamoDB Global Tables | https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html |
| Amazon S3 security best practices | https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html |
| S3 Block Public Access | https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html |
| S3 Object Ownership / disabling ACLs | https://docs.aws.amazon.com/AmazonS3/latest/userguide/about-object-ownership.html |
| S3 Object Lock (WORM) | https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html |
| Amazon SQS Developer Guide | https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html |
| Amazon SNS Developer Guide | https://docs.aws.amazon.com/sns/latest/dg/welcome.html |
| Amazon EventBridge User Guide | https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html |
| Amazon MSK Developer Guide | https://docs.aws.amazon.com/msk/latest/developerguide/what-is-msk.html |
| Elastic Load Balancing — overview | https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/what-is-load-balancing.html |
| Application Load Balancer User Guide | https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html |
| Network Load Balancer User Guide | https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html |
| Gateway Load Balancer User Guide | https://docs.aws.amazon.com/elasticloadbalancing/latest/gateway/introduction.html |
| Amazon API Gateway Developer Guide | https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html |
| API Gateway — REST vs HTTP APIs | https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html |
| Amazon CloudFront Developer Guide | https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Introduction.html |
| CloudFront Origin Access Control | https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html |
| AWS WAF, Shield and Firewall Manager | https://docs.aws.amazon.com/waf/latest/developerguide/what-is-aws-waf.html |
| AWS WAF managed rule groups | https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups.html |
| Amazon CloudWatch User Guide | https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html |
| CloudWatch Application Signals & SLOs | https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-ServiceLevelObjectives.html |
| AWS CloudTrail User Guide | https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html |
| CloudTrail Lake | https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-lake.html |
| Amazon GuardDuty User Guide | https://docs.aws.amazon.com/guardduty/latest/ug/what-is-guardduty.html |
| GuardDuty foundational data sources | https://docs.aws.amazon.com/guardduty/latest/ug/guardduty_data-sources.html |
| AWS Security Hub CSPM | https://docs.aws.amazon.com/securityhub/latest/userguide/what-is-securityhub.html |
| AWS Well-Architected Framework | https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html |
| Well-Architected — Reliability pillar | https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html |
| Well-Architected — DR objectives (RTO/RPO definitions) | https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/disaster-recovery-dr-objectives.html |
| Whitepaper — Disaster Recovery of Workloads on AWS | https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-workloads-on-aws.html |
| DR options in the cloud (the four strategies) | https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html |
| Amazon Application Recovery Controller (ARC) | https://docs.aws.amazon.com/r53recovery/latest/dg/what-is-route53-recovery.html |
| AWS Fault Injection Service | https://docs.aws.amazon.com/fis/latest/userguide/what-is.html |
| AWS Resilience Hub | https://docs.aws.amazon.com/resilience-hub/latest/userguide/what-is.html |
| AWS Control Tower | https://docs.aws.amazon.com/controltower/latest/userguide/what-is-control-tower.html |
| AWS Prescriptive Guidance — transactional outbox | https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html |
| AWS PCI DSS compliance | https://aws.amazon.com/compliance/pci-dss-level-1-faqs/ |

---

**Previous:** [08 — Apache Kafka](./08-Apache-Kafka.md) | **Next:** [10 — Kubernetes](./10-Kubernetes.md)
