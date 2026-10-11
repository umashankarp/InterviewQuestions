(function (r) {
registerTopic('22-azure', {
related: ['21-aws', '23-kubernetes', '25-devops'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['resource-hierarchy', 'arm', 'aws-mapping'],
  q: r`Explain Azure's resource hierarchy — tenant, management groups, subscriptions, resource groups — and Azure Resource Manager. How does it map to AWS Organizations and accounts, and where does it differ?`,
  a: r`**The hierarchy**
- **Microsoft Entra tenant**: the identity boundary (users, groups, app registrations). One organisation usually has one tenant.
- **Management groups**: a tree (up to 6 levels below the root) used to apply **Azure Policy** and **RBAC** to many subscriptions at once.
- **Subscription**: the billing and **scale/quota boundary** and a key security boundary. Closest AWS equivalent: an **account**.
- **Resource group (RG)**: a logical container for resources that share a **lifecycle** (deploy, secure and delete together). Every resource lives in exactly one RG; an RG has a region for its metadata but can hold resources from any region.
- **Resource**: the VM, storage account, database.

**Azure Resource Manager (ARM)** is the single control plane: portal, CLI, PowerShell, Bicep/Terraform and SDKs all call the same ARM REST API, which authenticates with Entra ID, authorises with **Azure RBAC**, evaluates **Azure Policy**, and then calls resource providers ({{Microsoft.Sql}}, {{Microsoft.Web}}).

**Mapping to AWS**
| Azure | AWS |
|---|---|
| Entra tenant | IAM Identity Center + identity store (not an exact match) |
| Management group | Organizational Unit |
| Subscription | Account |
| Resource group | no direct equivalent (closest: tags, CloudFormation stack) |
| Azure Policy | SCPs + AWS Config rules (combined) |

**Real differences to say aloud**
- Azure separates **identity (tenant)** from **resource containers (subscriptions)**; in AWS, IAM lives inside each account.
- **Resource groups** give a lifecycle grouping AWS lacks — deleting an RG deletes everything in it (use **resource locks** on production RGs).
- **Azure Policy can modify and deploy** (append tags, deploy diagnostics), not only deny — broader than SCPs.
- Subscriptions have per-subscription quotas (cores per region, and so on), so "subscription per workload per environment" mirrors "account per workload".`,
  code: r`~~~bash
# Inspect the hierarchy and lock a production resource group against deletion
az account management-group list -o table
az account list --query "[].{name:name, id:id, tenant:tenantId}" -o table
az group create -n rg-payments-prod-weu -l westeurope --tags owner=payments costCenter=CC-410 env=prod
az lock create -n no-delete --lock-type CanNotDelete -g rg-payments-prod-weu
~~~`,
  dia: r`flowchart TB
  T[Entra tenant - identities] --> ROOT[Tenant root management group]
  ROOT --> PLAT[MG: Platform]
  ROOT --> LZ[MG: Landing zones]
  LZ --> CORP[MG: Corp - private]
  LZ --> ONL[MG: Online - internet facing]
  CORP --> SUB1[Subscription: payments-prod]
  CORP --> SUB2[Subscription: payments-dev]
  SUB1 --> RG1[RG: rg-payments-prod-weu]
  RG1 --> R1[App Service]
  RG1 --> R2[Azure SQL]
  ARM[Azure Resource Manager: authN Entra, authZ RBAC, Policy] -.every request.-> SUB1`,
  pts: [r`Tenant = identity; management groups = policy/RBAC tree; subscription = billing, quota and security boundary; resource group = lifecycle.`, r`ARM is the single control plane for every tool.`, r`Subscription maps to AWS account; management group to OU.`, r`Azure Policy can deny, audit, modify and deploy.`, r`Lock production resource groups; deleting an RG deletes its contents.`],
  ex: r`A bank lost a non-production environment when an engineer deleted the wrong resource group; CanNotDelete locks on every production RG, enforced by Azure Policy, followed the same week.`,
  fu: [r`Why one subscription per workload per environment rather than one big subscription?`, r`What happens to RBAC assignments when a subscription moves to another management group?`],
  pit: [r`Treating a resource group as a security boundary equivalent to an AWS account.`, r`Putting unrelated lifecycles in one resource group.`, r`Confusing the Entra tenant with a subscription.`] },

{ id: 'q2', level: 'Basic', tags: ['entra-id', 'rbac', 'pim'],
  q: r`Entra ID roles versus Azure RBAC roles: what does each control? Explain role assignments, scopes, inheritance, deny assignments, and how Privileged Identity Management changes standing access.`,
  a: r`Azure has **two separate authorisation planes**, and confusing them is a classic interview miss.

**Entra ID roles** control the **directory**: Global Administrator, User Administrator, Application Administrator, Conditional Access Administrator. They manage users, groups, app registrations and tenant settings.

**Azure RBAC roles** control **Azure resources** through ARM: Owner, Contributor, Reader, plus hundreds of service roles (Key Vault Secrets User, Storage Blob Data Reader, AKS RBAC Writer).

**A role assignment = principal + role definition + scope.**
- **Principal**: user, group, service principal or managed identity.
- **Role definition**: allowed {{Actions}} (control plane, such as creating a storage account) and {{DataActions}} (data plane, such as reading a blob), minus {{NotActions}}.
- **Scope**: management group → subscription → resource group → resource. Assignments **inherit downwards**.

**Effective access** is the union of all assignments (RBAC is additive). Exceptions:
- **Deny assignments** block actions even if a role allows them; you cannot create them directly — they come from **deployment stacks** and managed applications.
- **Azure Policy** can block a deployment even when RBAC allows it.

**Control plane vs data plane**: Contributor can create a storage account and, through key-based auth, read its data — unless you **disable shared key access** and require Entra auth with data roles. Same idea for Key Vault (RBAC model) and Cosmos DB (data-plane RBAC).

**Privileged Identity Management (PIM)** replaces **standing** privilege with **eligible** assignments: an engineer activates Owner on a production subscription for 2 hours, with justification, MFA, optional approval and a full audit trail. Combine with **access reviews** and break-glass accounts excluded from Conditional Access but monitored.

**AWS mapping**: RBAC ≈ IAM policies attached via roles; scopes ≈ resource ARNs; PIM ≈ temporary elevation via Identity Center permission sets with approval tooling.`,
  code: r`~~~bash
# Least privilege at the narrowest scope: the app's identity may read secrets from one vault only
az role assignment create \
  --assignee-object-id <managed-identity-principal-id> --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope /subscriptions/<sub>/resourceGroups/rg-payments-prod-weu/providers/Microsoft.KeyVault/vaults/kv-payments-prod

# Disable shared key auth so storage data access requires Entra ID + data-plane roles
az storage account update -n stpaymentsprod -g rg-payments-prod-weu --allow-shared-key-access false
~~~`,
  dia: r`flowchart LR
  U[Engineer] -->|PIM activation: MFA, justification, 2h| RA[Role assignment]
  RA --> RD[Role: Owner]
  RA --> SC[Scope: subscription payments-prod]
  SC --> RG[Resource groups inherit]
  ENT[Entra roles] -->|directory: users, apps| DIR[Entra tenant]
  RBAC[Azure RBAC] -->|resources via ARM| SC`,
  pts: [r`Entra roles manage the directory; Azure RBAC manages resources.`, r`Assignment = principal + role + scope; inherits downward; additive.`, r`Actions vs DataActions: control plane vs data plane.`, r`Disable key-based access so data access needs Entra auth.`, r`PIM gives just-in-time, approved, audited elevation instead of standing access.`],
  ex: r`An audit found 41 standing Owner assignments on production subscriptions; moving them to PIM-eligible with approval cut standing privileged access to two break-glass accounts.`,
  fu: [r`Why can a Contributor read data in a storage account by default?`, r`How do you handle emergency access if Entra ID or MFA is unavailable?`],
  pit: [r`Granting Global Administrator to manage Azure resources.`, r`Assigning roles to individual users instead of groups.`, r`Ignoring data-plane access via account keys.`] },

{ id: 'q3', level: 'Basic', tags: ['managed-identity', 'defaultazurecredential', 'workload-identity'],
  q: r`How does a .NET app on Azure authenticate to Key Vault, Storage and Azure SQL without secrets? Explain system- versus user-assigned managed identities, DefaultAzureCredential, and workload identity federation.`,
  a: r`**Managed identity** = a service principal in Entra ID whose credentials Azure manages and rotates. The app asks the local **Instance Metadata Service** (or the App Service/Functions identity endpoint) for a token; no secret ever exists in config.

| | System-assigned | User-assigned |
|---|---|---|
| Lifecycle | tied to one resource; deleted with it | standalone resource, attach to many |
| Use | simple one-app cases | shared identity across slots/instances, pre-created role assignments before deploy, AKS workload identity |

User-assigned is often preferred in production: you grant roles **before** the app exists (IaC ordering), and blue/green slots or scale-out instances share it.

**DefaultAzureCredential** (Azure.Identity) tries a chain: environment variables → workload identity → managed identity → developer tools (Visual Studio, Azure CLI, azd). The same code runs locally (developer's identity) and in Azure (managed identity). In production, prefer an explicit **{{ManagedIdentityCredential}}** (or set {{AZURE_TOKEN_CREDENTIALS}} to restrict the chain), which avoids slow fallbacks and surprises.

**Using the token**
- Key Vault / Storage / Service Bus SDK clients accept a {{TokenCredential}}.
- **Azure SQL**: {{Authentication=Active Directory Managed Identity}} in the connection string (Microsoft.Data.SqlClient), with a contained database user created {{FROM EXTERNAL PROVIDER}}.
- Tokens are cached and refreshed by the SDK; create clients once (singleton).

**Workload identity federation**: for code **outside** Azure — GitHub Actions, AWS, GCP, on-premises Kubernetes, AKS pods — Entra trusts an external OIDC token (issuer + subject) and exchanges it for an Entra token. No client secret or certificate to rotate. AKS **Workload Identity** uses this: a Kubernetes service account token is federated to a user-assigned identity.

**AWS mapping**: managed identity ≈ instance/task role; DefaultAzureCredential ≈ the SDK default credential provider chain; workload identity federation ≈ {{AssumeRoleWithWebIdentity}}.`,
  code: r`~~~csharp
// Program.cs - one credential, singleton clients; no secrets in configuration
var credential = builder.Environment.IsDevelopment()
    ? new DefaultAzureCredential()                                       // developer identity locally
    : new ManagedIdentityCredential(builder.Configuration["AZURE_CLIENT_ID"]); // user-assigned MI in Azure

builder.Services.AddAzureClients(c =>
{
    c.UseCredential(credential);
    c.AddSecretClient(new Uri("https://kv-payments-prod.vault.azure.net/"));
    c.AddBlobServiceClient(new Uri("https://stpaymentsprod.blob.core.windows.net/"));
    c.AddServiceBusClientWithNamespace("sb-payments-prod.servicebus.windows.net");
});

// Azure SQL with the same managed identity (Microsoft.Data.SqlClient 5.x)
// "Server=tcp:sql-payments-prod.database.windows.net;Database=ledger;
//  Authentication=Active Directory Managed Identity;User Id=<client-id>;Encrypt=True"
~~~
~~~sql
-- In the ledger database: map the managed identity to a least-privilege user
CREATE USER [id-payments-api] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [id-payments-api];
GRANT EXECUTE ON SCHEMA::payments TO [id-payments-api];
~~~`,
  dia: r`sequenceDiagram
  participant App as .NET app (App Service)
  participant IDP as Local identity endpoint
  participant Entra as Entra ID
  participant KV as Key Vault
  App->>IDP: request token for vault.azure.net
  IDP->>Entra: authenticate managed identity
  Entra-->>IDP: access token
  IDP-->>App: token, cached by SDK
  App->>KV: GET secret with bearer token
  KV-->>App: secret, RBAC checked`,
  pts: [r`Managed identities remove secrets; Azure rotates credentials.`, r`User-assigned identities allow role assignment before deployment and sharing across slots.`, r`DefaultAzureCredential for dev/prod parity; restrict the chain in production.`, r`Azure SQL supports managed identity auth with contained users.`, r`Workload identity federation for GitHub, AKS and other clouds.`],
  ex: r`A payments team removed 27 connection-string secrets by moving App Service, Functions and AKS workloads to user-assigned managed identities; the next pen test found no credentials in configuration.`,
  fu: [r`Why can DefaultAzureCredential cause slow start-up in production?`, r`How do you grant an identity access to Azure SQL with least privilege?`],
  pit: [r`Storing client secrets for service principals in app settings.`, r`System-assigned identities that change on redeploy and break role assignments.`, r`Creating a new credential and client per request.`] },

{ id: 'q4', level: 'Basic', tags: ['vnet', 'nsg', 'udr', 'networking'],
  q: r`Design an Azure VNet for a three-tier application: address space, subnets, NSGs, application security groups, route tables and outbound connectivity. Where does Azure networking differ from AWS VPCs?`,
  a: r`**Layout**: one VNet (for example {{10.20.0.0/16}}) with subnets per tier and per delegated service: {{snet-appgw}}, {{snet-app}} (App Service VNet integration, delegated), {{snet-aks}}, {{snet-data}} (private endpoints), {{AzureFirewallSubnet}}, {{GatewaySubnet}}.

**Key differences from AWS**
- **Subnets are regional and span availability zones**; in AWS each subnet lives in one AZ. Zone placement is a property of the resource (VM, zone-redundant service), not the subnet.
- No "public subnet" via an internet-gateway route: a resource is internet-reachable if it has a **public IP** or sits behind a public load balancer/gateway.
- Azure reserves **5 IPs** per subnet (AWS also reserves 5).
- Many PaaS services join the network through **private endpoints** (a NIC with a private IP) or **VNet integration** (outbound only), rather than living in your subnets.

**NSGs** (Network Security Groups): stateful allow/deny rules with priorities (100-4096; lowest number wins), attached to subnets and/or NICs. Default rules allow VNet-to-VNet and load-balancer probes and deny other inbound. Unlike AWS security groups, **NSGs support explicit deny** and are evaluated by priority; they behave like a merged SG + NACL.

**Application Security Groups (ASGs)** group NICs by role ({{asg-web}}, {{asg-app}}), so rules read "asg-web → asg-app on 8443" instead of IP ranges — the closest equivalent to AWS SG-to-SG references.

**Route tables (UDRs)** override system routes: send {{0.0.0.0/0}} to Azure Firewall for egress inspection (forced tunnelling), or on-premises ranges to a network virtual appliance.

**Outbound**: Microsoft is retiring **default outbound access** for VMs and moving to private-by-default subnets, so design explicit egress: **NAT Gateway** on the subnet (predictable public IPs for partner allow lists, 64,512 SNAT ports per public IP) or Azure Firewall. This also prevents **SNAT port exhaustion**.

**Service tags** ({{Sql.WestEurope}}, {{AzureMonitor}}) in NSG rules stand for Microsoft-managed IP ranges.`,
  code: r`~~~bicep
resource nsgApp 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: 'nsg-app'
  location: location
  properties: {
    securityRules: [
      {
        name: 'allow-web-to-app'
        properties: {
          priority: 100, direction: 'Inbound', access: 'Allow', protocol: 'Tcp'
          sourceApplicationSecurityGroups: [ { id: asgWeb.id } ]
          destinationApplicationSecurityGroups: [ { id: asgApp.id } ]
          sourcePortRange: '*', destinationPortRange: '8443'
        }
      }
      {
        name: 'deny-internet-inbound'
        properties: {
          priority: 4000, direction: 'Inbound', access: 'Deny', protocol: '*'
          sourceAddressPrefix: 'Internet', destinationAddressPrefix: '*', sourcePortRange: '*', destinationPortRange: '*'
        }
      }
    ]
  }
}

resource snetApp 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: vnet
  name: 'snet-app'
  properties: {
    addressPrefix: '10.20.2.0/24'
    networkSecurityGroup: { id: nsgApp.id }
    natGateway: { id: natGw.id }              // explicit, predictable egress IPs
    routeTable: { id: rtToFirewall.id }       // or force egress through Azure Firewall
  }
}
~~~`,
  dia: r`flowchart TB
  INET[Internet] --> AGW[App Gateway WAF - snet-appgw]
  subgraph VNET[VNet 10.20.0.0/16 - spans zones 1 2 3]
    AGW --> APP[App tier - snet-app, NSG + ASG]
    APP --> PE[Private endpoints - snet-data]
    APP --> NAT[NAT Gateway]
  end
  PE --> SQL[(Azure SQL)]
  PE --> KV[Key Vault]
  NAT --> PSP[Partner APIs - allow-listed IPs]`,
  pts: [r`Azure subnets span zones; zone is a resource property.`, r`NSGs are stateful with priorities and explicit deny; ASGs give role-based rules.`, r`UDRs force egress through a firewall or NVA.`, r`Use NAT Gateway for explicit egress; default outbound access is being retired.`, r`PaaS joins the network via private endpoints or VNet integration.`],
  ex: r`A payments API hit SNAT exhaustion calling a PSP through default outbound access; a NAT Gateway with two public IPs gave 129,024 ports and a stable allow-listed address.`,
  fu: [r`How would you allow AKS pods but not other workloads in a subnet to reach the database?`, r`What changes when you add Azure Firewall with forced tunnelling?`],
  pit: [r`Designing "one subnet per AZ" out of AWS habit.`, r`Relying on default outbound access.`, r`IP-based NSG rules that break on every scale event instead of ASGs or service tags.`] },

{ id: 'q5', level: 'Basic', tags: ['availability-zones', 'regions', 'redundancy'],
  q: r`Explain Azure regions, availability zones, region pairs and availability sets, and the storage redundancy options (LRS, ZRS, GRS, GZRS). How do zonal and zone-redundant deployments differ?`,
  a: r`**Regions and zones**: most major regions have **three availability zones** — physically separate datacentre groups with independent power, cooling and networking. Zone numbers are **logical per subscription**: your "zone 1" may be another subscription's "zone 2".

**Zonal vs zone-redundant**
- **Zonal**: you pin a resource to a zone (a VM in zone 2). You must deploy several and spread them yourself.
- **Zone-redundant**: the platform spreads the resource across zones automatically (zone-redundant Azure SQL, App Service plans with zone redundancy, ZRS storage, Standard Load Balancer frontends, Service Bus Premium). This is the default to look for.
- Check each service: some need a specific SKU (Premium/Business Critical) or must be zone-redundant **at creation**.

**Availability sets** (older): spread VMs across fault and update domains within one datacentre. Protects against rack and maintenance failures, not datacentre loss. Use zones where available.

**Region pairs**: many regions have a designated pair in the same geography (West Europe ↔ North Europe). Microsoft sequences platform updates across pairs and prioritises one region of the pair in a broad outage; GRS storage replicates to the pair. **Several newer regions have no pair** and Microsoft's guidance now favours zones first and your own choice of secondary region, so do not assume the pair is your DR answer.

**Storage redundancy**
| Option | Copies | Protects against | Durability (annual) |
|---|---|---|---|
| LRS | 3 in one datacentre | disk/rack failure | 11 nines |
| ZRS | 3 across zones | zone failure | 12 nines |
| GRS | LRS + async LRS in the secondary region | region failure | 16 nines |
| GZRS | ZRS + async LRS in the secondary region | zone and region | 16 nines |
| RA-GRS / RA-GZRS | plus read access to the secondary | read during outage | |

Geo-replication is **asynchronous** (RPO typically under 15 minutes for storage); failover is **customer-initiated** (or Microsoft-managed in a disaster) and the secondary becomes LRS until re-geo-replicated.

**AWS mapping**: AZs are similar; AWS has no region pairs; ZRS ≈ S3's default multi-AZ storage; GRS ≈ S3 Cross-Region Replication.`,
  code: r`~~~bicep
// Zone-redundant by default: storage (GZRS), App Service plan, Azure SQL
resource st 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'stpaymentsprod'
  location: 'westeurope'
  sku: { name: 'Standard_GZRS' }
  kind: 'StorageV2'
  properties: { minimumTlsVersion: 'TLS1_2', allowBlobPublicAccess: false, allowSharedKeyAccess: false }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'asp-payments-prod'
  location: 'westeurope'
  sku: { name: 'P1v3', capacity: 3 }            // at least 3 instances for zone redundancy
  properties: { zoneRedundant: true }
}

resource db 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: 'ledger'
  location: 'westeurope'
  sku: { name: 'BC_Gen5_4' }                    // Business Critical
  properties: { zoneRedundant: true }
}
~~~`,
  dia: r`flowchart LR
  subgraph WEU[West Europe]
    Z1[Zone 1: app instance, SQL replica]
    Z2[Zone 2: app instance, SQL replica]
    Z3[Zone 3: app instance, SQL replica]
  end
  subgraph NEU[North Europe - paired region]
    S[Async geo copy: GZRS secondary, SQL geo-secondary]
  end
  WEU -->|async replication| NEU`,
  pts: [r`Zone numbers are logical per subscription.`, r`Prefer zone-redundant services; zonal means you spread instances yourself.`, r`Availability sets protect within a datacentre only.`, r`Region pairs exist but are not automatically your DR design; some regions have none.`, r`LRS, ZRS, GRS, GZRS trade cost for zone and region protection; geo copies are asynchronous.`],
  ex: r`A fund administrator found its App Service plan was not zone-redundant because the setting can only be chosen at creation; it rebuilt the plan as a zone-redundant P1v3 with three instances during a maintenance window.`,
  fu: [r`Why can't you compare "zone 1" across two subscriptions?`, r`What happens to a GZRS account after a customer-initiated failover?`],
  pit: [r`Assuming all resources are zone-redundant by default.`, r`Using LRS for critical data.`, r`Assuming the paired region is always available and suitable for DR.`] },

{ id: 'q6', level: 'Basic', tags: ['compute', 'decision-framework', 'app-service', 'container-apps'],
  q: r`App Service, Azure Functions, Container Apps, AKS or VMs: how do you choose compute for a new .NET service on Azure?`,
  a: r`| | App Service | Functions | Container Apps | AKS | VMs / VMSS |
|---|---|---|---|---|---|
| Unit | web app (code or container) | function (triggers/bindings) | container, revisions | Kubernetes pods | VM |
| Ops burden | very low | very low | low | high | highest |
| Scale | autoscale rules | event-driven to zero (Flex Consumption) | KEDA rules, scale to zero | HPA/KEDA + node autoscaling | VMSS autoscale |
| Strengths | slots, easy auth, mature for ASP.NET | event glue, bindings, Durable Functions | microservices without Kubernetes ops, Dapr, jobs | full Kubernetes control, ecosystem | full OS control |
| AWS analogue | Elastic Beanstalk / App Runner | Lambda | App Runner / ECS Fargate | EKS | EC2 / ASG |

**Decision questions**
1. **Is it a web API or site with steady traffic?** App Service is the shortest path for ASP.NET Core: deployment slots, autoscale, VNet integration, managed certificates.
2. **Is it event-driven, spiky, short-lived work?** Functions (Flex Consumption for new serverless apps; Premium for always-warm instances and VNet). Use the **isolated worker model** — the in-process model reaches end of support in November 2026.
3. **Several containerised microservices, queue workers, scale to zero, but no Kubernetes team?** **Container Apps**: managed Kubernetes underneath with KEDA, Dapr, revisions and traffic splitting.
4. **Need Kubernetes APIs** (operators, service mesh, custom controllers, portability), and a platform team to run it? **AKS** (or AKS Automatic to reduce operations).
5. **Need OS control, legacy Windows software, special licensing?** VMs/VMSS.

**Senior nuance**: decide per workload, but standardise a small number of golden paths. Consider network isolation needs (App Service Environment v3 or Premium VNet integration for regulated workloads), cold-start tolerance, long-running work (Functions Consumption time limits), and cost at steady load.`,
  code: r`~~~csharp
// Same ASP.NET Core app, portable across App Service, Container Apps and AKS:
// health endpoints, config from environment, managed identity, OpenTelemetry
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHealthChecks();
builder.Services.AddOpenTelemetry().UseAzureMonitor();   // Azure.Monitor.OpenTelemetry.AspNetCore
var app = builder.Build();
app.MapHealthChecks("/health/live");
app.MapGet("/v1/quotes/{pair}", (string pair, IQuoteService q) => q.Get(pair));
app.Run();
~~~
~~~dockerfile
FROM mcr.microsoft.com/dotnet/aspnet:8.0-noble-chiseled
WORKDIR /app
COPY ./publish .
USER $APP_UID
ENTRYPOINT ["dotnet", "Quotes.Api.dll"]
~~~`,
  dia: r`flowchart TD
  W[New .NET workload] --> Q1{Web API with steady traffic?}
  Q1 -->|yes| AS[App Service]
  Q1 -->|no| Q2{Event-driven, short, spiky?}
  Q2 -->|yes| FN[Functions - isolated worker]
  Q2 -->|no| Q3{Need Kubernetes APIs and have a platform team?}
  Q3 -->|no| CA[Container Apps]
  Q3 -->|yes| AKS[AKS]
  Q3 -->|OS control / legacy| VM[VMs / VMSS]`,
  pts: [r`App Service for straightforward web APIs with slots and low operations.`, r`Functions for event-driven glue; isolated worker model; Flex Consumption or Premium.`, r`Container Apps for microservices without running Kubernetes.`, r`AKS only when you need Kubernetes and can operate it.`, r`Standardise a few golden paths; keep apps portable through containers and config.`],
  ex: r`An asset manager moved 14 small APIs from AKS to Container Apps and App Service, retiring a cluster that two engineers spent half their time upgrading.`,
  fu: [r`When would App Service Environment v3 be required?`, r`What makes Container Apps a poor fit?`],
  pit: [r`Defaulting to AKS for a handful of APIs.`, r`Starting new Functions on the in-process model.`, r`Ignoring Functions plan limits for long-running work.`] },

{ id: 'q7', level: 'Intermediate', tags: ['key-vault', 'secrets', 'certificates', 'hsm'],
  q: r`Use Key Vault correctly: secrets versus keys versus certificates, RBAC versus access policies, soft delete and purge protection, Key Vault references, caching and throttling, and when you need Managed HSM.`,
  a: r`**Object types**
- **Secrets**: arbitrary values (connection strings for third parties, API keys). Prefer managed identities so fewer secrets exist at all.
- **Keys**: RSA/EC keys for encrypt/decrypt/sign/wrap. Private key material never leaves the vault (software-protected in Standard, HSM-protected in Premium).
- **Certificates**: X.509 lifecycle management (create, auto-renew with integrated CAs, import), exposed as a key + secret.

**Authorisation**: use the **Azure RBAC permission model** (Key Vault Secrets User, Crypto User, Certificates Officer) rather than legacy access policies — RBAC works at vault or individual secret scope, integrates with PIM, and separates management (Contributor cannot read secrets).

**Protection**
- **Soft delete** is always on (7-90 days retention). **Purge protection** prevents permanent deletion during that period, even by an admin — required for CMK scenarios (a deleted encryption key means unreadable data) and expected in regulated estates.
- Network: **private endpoint** + public network access disabled; firewall exceptions only where required.
- Diagnostic logs to Log Analytics; alert on unusual access.
- **Separate vaults per app per environment**: blast radius and throttling limits are per vault.

**Consuming secrets**
- **App Service/Functions Key Vault references** ({{@Microsoft.KeyVault(SecretUri=...)}}) resolve at start-up with the app's managed identity.
- **.NET configuration provider** ({{AddAzureKeyVault}}) loads secrets into {{IConfiguration}} with periodic reload.
- **Do not call Key Vault per request**: vaults are throttled (on the order of thousands of transactions per 10 seconds per vault, varying by operation type). Cache and reload.

**Rotation**: Event Grid events ({{SecretNearExpiry}}) trigger a Function that rotates the credential at the source and writes a new version; apps reload. Use **two-credential rotation** so old and new both work during propagation.

**Managed HSM**: a dedicated, single-tenant FIPS 140-3 Level 3 HSM pool with full key isolation — for strict regulatory requirements (card-issuing keys, BYOK with sole control). **Azure Payment HSM** exists for payment-specific HSM workloads (PIN, card verification).`,
  code: r`~~~csharp
// Load secrets once with reload; never fetch per request
builder.Configuration.AddAzureKeyVault(
    new Uri("https://kv-payments-prod.vault.azure.net/"),
    new ManagedIdentityCredential(builder.Configuration["AZURE_CLIENT_ID"]),
    new AzureKeyVaultConfigurationOptions { ReloadInterval = TimeSpan.FromMinutes(5) });

// Bind a PSP API key ("Psp--ApiKey" in the vault becomes "Psp:ApiKey")
builder.Services.Configure<PspOptions>(builder.Configuration.GetSection("Psp"));
~~~
~~~bash
# Hardened vault: RBAC model, purge protection, no public network access
az keyvault create -n kv-payments-prod -g rg-payments-prod-weu -l westeurope \
  --enable-rbac-authorization true --enable-purge-protection true \
  --retention-days 90 --public-network-access Disabled --sku premium
~~~`,
  dia: r`flowchart LR
  APP[App Service - managed identity] -->|start-up, every 5 min| KV[Key Vault - private endpoint, RBAC]
  KV -->|SecretNearExpiry event| EG[Event Grid]
  EG --> FN[Rotation function]
  FN -->|new credential| PSP[Partner portal / DB]
  FN -->|new secret version| KV
  KV --> LOG[Diagnostic logs - Log Analytics]`,
  pts: [r`Secrets, keys and certificates have different lifecycles; keys never leave the vault.`, r`Use the RBAC permission model, not access policies.`, r`Purge protection and private endpoints for production vaults.`, r`Cache secrets; vaults are throttled per vault.`, r`Automate rotation with Event Grid; Managed HSM or Payment HSM for strict key custody.`],
  ex: r`A card platform's API called Key Vault on every request and was throttled during a sale; moving to the configuration provider with a 5-minute reload cut vault calls from millions per hour to a few dozen.`,
  fu: [r`What breaks if someone purges a customer-managed key used by Azure SQL TDE?`, r`How do you rotate a secret with zero downtime?`],
  pit: [r`Calling Key Vault per request.`, r`One shared vault for every app and environment.`, r`Purge protection disabled on vaults holding encryption keys.`] },

{ id: 'q8', level: 'Intermediate', tags: ['private-endpoint', 'service-endpoint', 'private-dns'],
  q: r`Private Endpoints versus Service Endpoints: how do they work, why does private DNS cause most failures, and how do you design DNS for private endpoints across hub-spoke and on-premises?`,
  a: r`**Service Endpoints**: extend your subnet's identity to a PaaS service over the Azure backbone. The service still has a **public IP**; you add a firewall rule allowing your subnet. Free, simple, but the service stays publicly addressable, it is not reachable from on-premises, and it is scoped per service type rather than per instance.

**Private Endpoints** (Private Link): a **NIC with a private IP in your subnet** mapped to one specific resource (one storage account's blob service, one SQL server). You can then **disable public network access** entirely. Reachable from peered VNets and on-premises. Charged per hour and per GB. Mapping to AWS: interface VPC endpoints / PrivateLink.

**Why DNS breaks it**: clients connect to the normal name, {{stpayments.blob.core.windows.net}}. Azure returns a CNAME to {{stpayments.privatelink.blob.core.windows.net}}. If the client's DNS resolves the **privatelink** name through a **Private DNS zone** linked to its VNet, it gets {{10.20.4.5}}; otherwise it gets the public IP — which now refuses connections because public access is disabled. Symptoms: works from one VNet, fails from another or from on-premises; "403 This request is not authorized" or connection timeouts.

**DNS design at scale**
1. Create the **privatelink Private DNS zones centrally** (in the connectivity/hub subscription), one per service type ({{privatelink.database.windows.net}}, {{privatelink.vaultcore.azure.net}}...).
2. **Link** them to the hub VNet (and spokes, or rely on the hub resolver).
3. Use **Azure Policy (DeployIfNotExists)** to register every new private endpoint's record in the central zone automatically — teams cannot forget.
4. **Azure DNS Private Resolver** in the hub: an inbound endpoint for on-premises DNS servers to forward {{privatelink.*}} queries; an outbound endpoint with forwarding rules for on-premises zones.
5. Never create duplicate privatelink zones per spoke — they split the namespace and cause intermittent failures.

**Testing**: {{nslookup stpayments.blob.core.windows.net}} from each client network must return a private IP.`,
  code: r`~~~bicep
resource pe 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: 'pe-sql-payments'
  location: location
  properties: {
    subnet: { id: snetData.id }
    privateLinkServiceConnections: [ {
      name: 'sql'
      properties: { privateLinkServiceId: sqlServer.id, groupIds: [ 'sqlServer' ] }
    } ]
  }
}

// Register the A record in the central privatelink zone (often done by Azure Policy instead)
resource dnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: pe
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [ { name: 'sql', properties: { privateDnsZoneId: hubSqlPrivateZoneId } } ]
  }
}
~~~
~~~text
> nslookup sql-payments-prod.database.windows.net     (from a spoke or on-premises)
Name:    sql-payments-prod.privatelink.database.windows.net
Address: 10.20.4.7          <- correct: private IP. A public IP here means DNS is wrong.
~~~`,
  dia: r`flowchart LR
  ONP[On-prem client] -->|query privatelink| ONDNS[On-prem DNS]
  ONDNS -->|conditional forward| IN[DNS Private Resolver inbound - hub]
  APP[Spoke app] --> AZDNS[Azure DNS 168.63.129.16]
  IN --> PZ[Private DNS zone privatelink.database.windows.net - hub]
  AZDNS --> PZ
  PZ -->|10.20.4.7| PE[Private endpoint NIC]
  PE --> SQL[(Azure SQL - public access disabled)]`,
  pts: [r`Service endpoints keep the public IP; private endpoints give a private IP per resource.`, r`Private endpoints allow disabling public access and work from on-premises.`, r`Most failures are DNS: the privatelink name must resolve to the private IP everywhere.`, r`Central privatelink zones, auto-registration via Azure Policy, DNS Private Resolver for hybrid.`, r`Never duplicate privatelink zones per spoke.`],
  ex: r`A bank's reporting job worked in Azure but failed from on-premises after public access was disabled; adding a conditional forwarder to the hub's DNS Private Resolver for privatelink zones fixed it.`,
  fu: [r`Why do duplicate privatelink zones cause intermittent failures?`, r`How does a private endpoint interact with a forced-tunnelling route table?`],
  pit: [r`Disabling public access before DNS works from every client network.`, r`Creating privatelink zones in each spoke.`, r`Thinking service endpoints make a service private.`] },

{ id: 'q9', level: 'Intermediate', tags: ['front-door', 'application-gateway', 'load-balancer', 'traffic-manager'],
  q: r`Front Door, Application Gateway, Azure Load Balancer or Traffic Manager? Explain what each does, how they combine for a global .NET API, and where WAF belongs.`,
  a: r`| Service | Layer | Scope | What it does | AWS analogue |
|---|---|---|---|---|
| **Front Door** (Standard/Premium) | 7 (HTTP) | global, anycast edge | TLS at the edge, caching, global routing by latency/priority/weight, health probes, WAF, Private Link to origins (Premium) | CloudFront + Global Accelerator + WAF |
| **Application Gateway** v2 | 7 | regional | path/host routing, TLS termination, WAF, autoscaling, AGIC/Application Gateway for Containers | ALB + WAF |
| **Azure Load Balancer** Standard | 4 (TCP/UDP) | regional (or cross-region tier) | high-performance pass-through, zone-redundant frontends, HA ports | NLB |
| **Traffic Manager** | DNS | global | DNS-based routing (priority, weighted, performance, geographic) to any endpoint | Route 53 routing policies |

**Typical global API**: **Front Door** (WAF policy, TLS, routing to the closest healthy region) → per-region origin. The origin is either App Service/Container Apps directly over **Private Link** (Front Door Premium) or an **Application Gateway** in a hub VNet when you need regional L7 routing to private backends.

**Locking the origin**: an origin must reject traffic that bypasses Front Door — use Private Link origins, or restrict by the {{AzureFrontDoor.Backend}} service tag **and** validate the {{X-Azure-FDID}} header equals your profile's id (the service tag alone allows any customer's Front Door).

**WAF placement**: at Front Door for global/internet traffic (OWASP managed rule set, bot protection, rate limiting at the edge). Add App Gateway WAF only if traffic can reach the region without Front Door (internal or partner paths). Avoid double WAF on the same path — two tuning burdens, double false positives.

**Traffic Manager** fits non-HTTP or when you need DNS-level failover across anything; failover speed is limited by DNS TTLs and client caching.

**Retirements to know**: Basic Load Balancer retired (September 2025) — Standard only; Front Door (classic) is being retired in favour of Standard/Premium; Application Gateway v1 is being retired in favour of v2.`,
  code: r`~~~csharp
// Origin guard: accept traffic only from our Front Door profile (in addition to network restrictions)
app.Use(async (ctx, next) =>
{
    var fdid = ctx.Request.Headers["X-Azure-FDID"].ToString();
    if (!string.Equals(fdid, builder.Configuration["FrontDoor:Id"], StringComparison.OrdinalIgnoreCase)
        && !ctx.Request.Path.StartsWithSegments("/health"))
    {
        ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }
    await next();
});
app.UseForwardedHeaders(new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto });
~~~`,
  dia: r`flowchart LR
  U[Clients worldwide] --> FD[Front Door Premium: WAF, TLS, caching]
  FD -->|Private Link, priority 1| WEU[West Europe: Container Apps]
  FD -->|Private Link, priority 2| NEU[North Europe: Container Apps]
  PART[Partner via VPN] --> AGW[Application Gateway WAF - hub]
  AGW --> WEU
  TM[Traffic Manager - DNS] -.non-HTTP failover.-> LB[Standard Load Balancer - TCP service]`,
  pts: [r`Front Door is global L7 at the edge; App Gateway is regional L7; Load Balancer is L4; Traffic Manager is DNS.`, r`Global API: Front Door to regional origins, via Private Link where possible.`, r`Lock origins with Private Link or service tag plus X-Azure-FDID check.`, r`One WAF per path, at the outermost layer.`, r`Know retirements: Basic LB, Front Door classic, App Gateway v1.`],
  ex: r`A broker's API accepted direct traffic because it only allowed the Front Door service tag; an attacker's own Front Door profile bypassed WAF until the team added the X-Azure-FDID check and moved to Private Link origins.`,
  fu: [r`Why does the AzureFrontDoor.Backend service tag alone not protect an origin?`, r`When would you put both Front Door and Application Gateway in the path?`],
  pit: [r`Origins reachable without Front Door.`, r`Double WAF with uncoordinated rules.`, r`Expecting Traffic Manager failover to be instant.`] },

{ id: 'q10', level: 'Intermediate', tags: ['app-service', 'deployment-slots', 'scaling'],
  q: r`Run an ASP.NET Core API on App Service in production: plans and scaling, deployment slots and swaps with warm-up, slot-sticky settings, VNet integration, health check, and the common traps.`,
  a: r`**Plans**: the **App Service plan** is the compute (VM instances); apps on a plan share it. Production: Premium v3 (or isolated in an App Service Environment v3 for full network isolation). Scale up (bigger SKU) or out (more instances, manual or **autoscale** rules; automatic scaling based on HTTP traffic is also available on Premium).

**Deployment slots** (Standard and above): {{staging}} is a live app with its own hostname. Deploy to staging, warm it, **swap**:
1. Slot-specific settings from the target are applied to the source slot's instances (this restarts them).
2. **Warm-up**: App Service requests the root (or paths in {{applicationInitialization}}) on every instance until they respond.
3. Routing switches — no cold start for users, and **swap back** is the rollback.

**Slot-sticky settings** ("deployment slot setting"): values that belong to the environment, not the build — for example a staging connection string or a feature flag. Everything else travels with the code. Getting this wrong points production at the staging database after a swap.

**Swap traps**: database schema changes must be backward-compatible (both versions run during and after swap — expand/contract migrations); in-memory sessions are lost (use distributed cache); long-running background work on the old slot gets killed.

**Health check** ({{/health}}): instances failing for a configured period are removed from load balancing and replaced. Keep it a readiness-style check.

**Networking**: **VNet integration** for outbound access to private endpoints (route all traffic through the VNet); **private endpoint** for inbound so the app is not public; access restrictions for Front Door only.

**Common traps**
- **ARR affinity** (sticky sessions cookie) on by default — turn it off for stateless APIs.
- **SNAT port exhaustion** on outbound calls: reuse {{HttpClient}} via {{IHttpClientFactory}}, use private endpoints/NAT Gateway (see q33).
- **Always On** off: the app unloads when idle and the first request is slow.
- Writing to local disk: instances are replaced; {{%HOME%}} is shared storage, slow for heavy I/O.`,
  code: r`~~~bash
# Deploy to staging, verify, then swap; swap back is the rollback
az webapp deploy -g rg-payments-prod-weu -n app-payments-api --slot staging --src-path app.zip --type zip
curl -fsS https://app-payments-api-staging.azurewebsites.net/health
az webapp deployment slot swap -g rg-payments-prod-weu -n app-payments-api --slot staging --target-slot production

# Environment-bound values are slot settings so they do not move on swap
az webapp config appsettings set -g rg-payments-prod-weu -n app-payments-api --slot staging \
  --slot-settings "Ledger__Endpoint=https://ledger-staging.internal" "FeatureFlags__Env=staging"
az webapp update -g rg-payments-prod-weu -n app-payments-api --client-affinity-enabled false
~~~
~~~xml
<!-- web.config: warm-up paths used during swap and scale-out -->
<system.webServer>
  <applicationInitialization>
    <add initializationPage="/health/ready" />
    <add initializationPage="/v1/warmup" />
  </applicationInitialization>
</system.webServer>
~~~`,
  dia: r`sequenceDiagram
  participant CI as Pipeline
  participant ST as Staging slot
  participant PR as Production slot
  CI->>ST: deploy build
  CI->>ST: apply production slot-sticky settings, restart
  ST->>ST: warm-up requests on every instance
  CI->>PR: swap routing
  Note over ST,PR: old version now in staging, swap back = rollback`,
  pts: [r`The plan is the compute; scale up or out with autoscale.`, r`Slots with warm-up give zero-downtime deploys and instant rollback.`, r`Mark environment-bound settings as slot settings.`, r`Backward-compatible schema changes because both versions run.`, r`Turn off ARR affinity, enable Always On, use health check, avoid SNAT exhaustion.`],
  ex: r`A wealth platform's first slot swap pointed production at the staging database because the connection string was not slot-sticky; marking environment settings sticky and adding a pre-swap configuration check prevented a repeat.`,
  fu: [r`How do you run EF Core migrations safely with slot swaps?`, r`When is App Service Environment v3 justified?`],
  pit: [r`Connection strings that move with a swap.`, r`ARR affinity on for stateless APIs.`, r`Breaking schema changes deployed with a swap.`] },

{ id: 'q11', level: 'Intermediate', tags: ['azure-sql', 'service-tiers', 'resilience', 'dotnet'],
  q: r`Choose and configure Azure SQL for a .NET service: Database versus Managed Instance, vCore tiers (General Purpose, Business Critical, Hyperscale), serverless, and connection resiliency in .NET.`,
  a: r`**Deployment options**
- **Azure SQL Database**: a managed database (single or elastic pool). Most PaaS-native; no SQL Agent or cross-database queries (use elastic jobs, elastic query).
- **Azure SQL Managed Instance**: near-100% SQL Server compatibility (SQL Agent, cross-database queries, CLR, Service Broker, linked servers), VNet-injected. The usual landing zone for lift-and-shift of SQL Server estates.
- **SQL Server on VMs**: full control when PaaS cannot fit.

**vCore service tiers** (the DTU model still exists for simple cases)
| Tier | Architecture | Fit |
|---|---|---|
| **General Purpose** | compute + remote premium storage; failover reattaches storage | most workloads; IO latency several ms |
| **Business Critical** | Always On availability group, local SSD, 4 replicas, one free readable secondary | low latency, high transaction rate, fast failover |
| **Hyperscale** | distributed page servers + log service, up to 128 TB, fast scaling, named replicas | large or fast-growing databases; now competitive for general use |

**Serverless** (General Purpose/Hyperscale): auto-scales vCores between min and max and can **auto-pause** — good for dev/test and intermittent apps; resume latency on first connection makes auto-pause unsuitable for production APIs.

**Connection resiliency in .NET**
- Azure SQL has **transient faults**: failovers during maintenance or scaling drop connections for seconds. Error numbers such as 40613, 40197, 49918, 4060, 10928/10929 are retryable.
- **EF Core**: {{EnableRetryOnFailure()}} uses an execution strategy with exponential backoff. User-initiated transactions must run **inside** {{strategy.ExecuteAsync}} so the whole unit is retried — and the unit must be **idempotent**.
- **Microsoft.Data.SqlClient** also has configurable retry logic ({{SqlRetryLogicOption}}) and connection retry ({{ConnectRetryCount}}).
- Use **managed identity** authentication, {{Encrypt=True}}, and the **Redirect** connection policy inside Azure (lower latency than Proxy).
- Size the connection pool deliberately; many app instances × pool max can hit the tier's worker limit (error 10928).`,
  code: r`~~~csharp
builder.Services.AddDbContextPool<LedgerDbContext>(o => o.UseSqlServer(
    builder.Configuration.GetConnectionString("Ledger"),       // Authentication=Active Directory Managed Identity
    sql => sql.EnableRetryOnFailure(maxRetryCount: 6, maxRetryDelay: TimeSpan.FromSeconds(10), errorNumbersToAdd: null)));

// Explicit transaction: run the whole unit inside the execution strategy, and keep it idempotent
public async Task PostAsync(Posting p, CancellationToken ct)
{
    var strategy = _db.Database.CreateExecutionStrategy();
    await strategy.ExecuteAsync(async () =>
    {
        await using var tx = await _db.Database.BeginTransactionAsync(ct);
        if (await _db.Postings.AnyAsync(x => x.PostingId == p.PostingId, ct)) return;   // idempotent on retry
        _db.Postings.Add(p);
        await _db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    });
}
~~~`,
  dia: r`flowchart LR
  APP[.NET app - EF Core retry strategy] -->|Redirect policy| GW[Azure SQL gateway]
  GW --> P[(Primary replica)]
  P -->|sync AG| S1[(Secondary - readable)]
  P -->|sync AG| S2[(Secondary)]
  P -->|sync AG| S3[(Secondary)]
  APP -.ApplicationIntent=ReadOnly.-> S1`,
  pts: [r`SQL Database for PaaS-native apps; Managed Instance for SQL Server compatibility.`, r`General Purpose remote storage; Business Critical local SSD AG with a free readable secondary; Hyperscale for scale.`, r`Serverless auto-pause is for dev/test, not production APIs.`, r`Transient faults are normal: EF Core retry strategy, idempotent units.`, r`Managed identity auth, Redirect policy, sized connection pools.`],
  ex: r`A settlement service failed nightly during Azure SQL maintenance failovers until EnableRetryOnFailure wrapped its transactions; failovers became 4-second pauses in logs.`,
  fu: [r`Why must an explicit transaction be idempotent when retried?`, r`When would you choose Hyperscale over Business Critical?`],
  pit: [r`No retry logic, treating failovers as outages.`, r`Retrying non-idempotent transactions.`, r`Serverless auto-pause in production.`] },

{ id: 'q12', level: 'Intermediate', tags: ['cosmos-db', 'partitioning', 'request-units', 'consistency'],
  q: r`Explain Cosmos DB fundamentals for a .NET architect: partition keys, request units, the five consistency levels, and using the .NET SDK efficiently.`,
  a: r`**Partitioning**: data is distributed by **partition key** into logical partitions (all items with the same key value, max **20 GB**) placed on physical partitions (up to **10,000 RU/s** and 50 GB each). A good key has **high cardinality**, spreads writes evenly, and matches the main query filter. Queries with the partition key are single-partition and cheap; cross-partition queries fan out. **Hierarchical partition keys** (up to three levels, such as tenant → user) relieve the 20 GB limit for large tenants.

**Request units (RU)**: a normalised cost of CPU, IO and memory. A **point read** of a 1 KB item by id + partition key costs **1 RU**; a 1 KB write about 5 RU or more (indexing adds cost). Capacity modes:
- **Provisioned** (manual or **autoscale** between 10% and 100% of max RU/s),
- **Serverless** (pay per RU consumed, for low or intermittent traffic).
Exceeding capacity returns **429** with a retry-after; the SDK retries automatically a limited number of times.

**Consistency levels** (strongest to weakest)
| Level | Guarantee | Typical use |
|---|---|---|
| Strong | linearizable reads | rarely; costs latency, limited with multi-region writes |
| Bounded staleness | reads lag by at most K versions or T time | global apps needing a bound |
| **Session** (default) | read-your-own-writes within a session token | most apps |
| Consistent prefix | no out-of-order reads | feeds |
| Eventual | no ordering guarantee | counters, non-critical |

Weaker consistency halves read RU cost relative to strong/bounded (which read from two replicas).

**.NET SDK practices**
- **One {{CosmosClient}} per process** (singleton), **direct mode** (default) for lowest latency.
- Prefer **point reads** ({{ReadItemAsync}} with id and partition key) over queries.
- Set {{ApplicationPreferredRegions}} for multi-region accounts.
- Log {{RequestCharge}} and diagnostics for slow calls; tune the **indexing policy** (exclude paths you never query).
- Use **optimistic concurrency** with ETags ({{IfMatchEtag}}).

**AWS mapping**: Cosmos DB (NoSQL API) ≈ DynamoDB — partition key ≈ partition key, RU ≈ RCU/WCU — but Cosmos offers tunable consistency levels and richer SQL-like queries.`,
  code: r`~~~csharp
builder.Services.AddSingleton(_ => new CosmosClient(
    "https://cosmos-payments-prod.documents.azure.com:443/",
    new ManagedIdentityCredential(clientId),
    new CosmosClientOptions
    {
        ApplicationPreferredRegions = [Regions.WestEurope, Regions.NorthEurope],
        ConsistencyLevel = ConsistencyLevel.Session,
        UseSystemTextJsonSerializerWithOptions = JsonSerializerOptions.Default
    }));

public async Task<Account?> GetAsync(string tenantId, string accountId, CancellationToken ct)
{
    try
    {
        var resp = await _container.ReadItemAsync<Account>(accountId, new PartitionKey(tenantId), cancellationToken: ct); // point read ~1 RU
        _log.LogDebug("RU {Charge}", resp.RequestCharge);
        return resp.Resource;
    }
    catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound) { return null; }
}

// Optimistic concurrency: fails with 412 if someone else updated the item
await _container.ReplaceItemAsync(updated, updated.Id, new PartitionKey(updated.TenantId),
    new ItemRequestOptions { IfMatchEtag = current.ETag }, ct);
~~~`,
  dia: r`flowchart LR
  APP[.NET app - singleton CosmosClient] -->|partition key = tenantId| C[(Container)]
  C --> P1[Physical partition 1: tenants A-F]
  C --> P2[Physical partition 2: tenants G-M]
  C --> P3[Physical partition 3: tenants N-Z]
  C -->|replication| R2[(North Europe replica)]`,
  pts: [r`Partition key: high cardinality, even writes, matches queries; 20 GB logical partition limit.`, r`RU is the cost unit; point reads ~1 RU; 429 means over capacity.`, r`Five consistency levels; Session is the default and right for most apps.`, r`Singleton client, direct mode, preferred regions, point reads.`, r`ETags for optimistic concurrency; tune indexing to cut RU.`],
  ex: r`A trading-alert service partitioned by alert type (5 values) and hit 429s on one hot partition; re-partitioning by userId spread load and cut RU provisioning by 60%.`,
  fu: [r`How do you change the partition key of an existing container?`, r`When would you choose bounded staleness over session?`],
  pit: [r`Low-cardinality partition keys.`, r`Creating a CosmosClient per request.`, r`Using queries where point reads would do.`] },

{ id: 'q13', level: 'Intermediate', tags: ['blob-storage', 'sas', 'immutability', 'lifecycle'],
  q: r`Use Blob Storage for customer documents and regulatory archives: access tiers, secure access (Entra RBAC, user delegation SAS), direct browser uploads, immutability (WORM), lifecycle management and events.`,
  a: r`**Tiers**: Hot, Cool (≥30 days), Cold (≥90 days), Archive (≥180 days, offline; rehydration takes hours). Early-deletion charges apply below the minimum durations. **Lifecycle management** policies move blobs between tiers or delete them by age or last access.

**Access, strongest first**
1. **Entra ID + data-plane RBAC** (Storage Blob Data Reader/Contributor) for services with managed identities. Disable **shared key access** at the account level so keys cannot be used at all.
2. **User delegation SAS**: a time-limited URL signed with a **user delegation key** obtained via Entra ID, not the account key. Revocable by revoking the delegation key; audited as the identity that created it.
3. Service/account SAS signed with account keys: avoid — anyone with the key can mint unlimited SAS, and rotating the key is the only revocation.

**Direct browser uploads (Angular/React)**: the API authorises the user, then returns a **short-lived user delegation SAS** scoped to one blob path with create/write permission only. The browser uploads straight to Blob Storage (block blobs, chunked for large files) — bytes never pass through the API. Configure **CORS** on the storage account for your SPA origin. An Event Grid {{BlobCreated}} event triggers malware scanning (Defender for Storage) and processing.

**Immutability (WORM)**
- **Time-based retention** policies (locked policies cannot be shortened or removed) and **legal holds**, at container or **version level**.
- Assessed by Cohasset for SEC 17a-4(f), FINRA and CFTC record-keeping. Test on non-production first; a locked policy cannot be undone.

**Data protection**: soft delete for blobs and containers, versioning, point-in-time restore for block blobs, and GZRS for regional resilience.

**Network**: private endpoint and public network access disabled — except for SPA uploads, which need either public access with SAS or a path through Front Door/private connectivity; decide explicitly.

**AWS mapping**: user delegation SAS ≈ S3 pre-signed URL (signed with role credentials); immutability policies ≈ S3 Object Lock; lifecycle ≈ S3 lifecycle rules.`,
  code: r`~~~csharp
// API issues a 10-minute, single-blob, create/write-only user delegation SAS for a browser upload
app.MapPost("/v1/documents/upload-url", async (UploadRequest req, ClaimsPrincipal user, BlobServiceClient blobs) =>
{
    var blobName = $"{user.FindFirstValue("tenant_id")}/{Guid.NewGuid():N}/{Path.GetFileName(req.FileName)}";
    var key = await blobs.GetUserDelegationKeyAsync(DateTimeOffset.UtcNow.AddMinutes(-5), DateTimeOffset.UtcNow.AddMinutes(15));

    var sas = new BlobSasBuilder
    {
        BlobContainerName = "incoming", BlobName = blobName, Resource = "b",
        ExpiresOn = DateTimeOffset.UtcNow.AddMinutes(10), Protocol = SasProtocol.Https
    };
    sas.SetPermissions(BlobSasPermissions.Create | BlobSasPermissions.Write);

    var uri = new BlobUriBuilder(blobs.GetBlobContainerClient("incoming").GetBlobClient(blobName).Uri)
        { Sas = sas.ToSasQueryParameters(key.Value, blobs.AccountName) }.ToUri();
    return Results.Ok(new { uploadUrl = uri, blobName });
}).RequireAuthorization();
~~~
~~~typescript
// Angular/React: upload straight to Blob Storage with @azure/storage-blob
const { uploadUrl } = await api.post('/v1/documents/upload-url', { fileName: file.name });
await new BlockBlobClient(uploadUrl).uploadData(file, { blockSize: 4 * 1024 * 1024, concurrency: 4 });
~~~`,
  dia: r`sequenceDiagram
  participant SPA as Angular/React SPA
  participant API as .NET API
  participant ST as Blob Storage
  participant EG as Event Grid
  SPA->>API: request upload URL (JWT)
  API->>ST: get user delegation key (managed identity)
  API-->>SPA: SAS URL, 10 min, create/write, one blob
  SPA->>ST: PUT blocks directly
  ST->>EG: BlobCreated
  EG->>API: process + malware scan result`,
  pts: [r`Hot, Cool, Cold, Archive with lifecycle rules; mind minimum durations and rehydration time.`, r`Prefer Entra RBAC; disable shared keys; use user delegation SAS when URLs are needed.`, r`Browser uploads go direct with short, narrow SAS; events drive processing.`, r`Locked time-based retention and legal holds for WORM; test first.`, r`Soft delete, versioning, GZRS and private endpoints for protection.`],
  ex: r`A wealth manager moved client document uploads from API streaming to direct SAS uploads; API memory spikes disappeared and 200 MB statement packs uploaded reliably from browsers.`,
  fu: [r`How do you revoke a user delegation SAS early?`, r`How would you prove WORM retention to an auditor?`],
  pit: [r`Account-key SAS tokens with long expiry.`, r`Streaming large uploads through the API.`, r`Locking an immutability policy without testing.`] },

{ id: 'q14', level: 'Intermediate', tags: ['service-bus', 'queues', 'sessions', 'dlq'],
  q: r`Explain Azure Service Bus: queues and topics, peek-lock, lock renewal, dead-lettering, duplicate detection, sessions and transactions. Write a correct .NET consumer.`,
  a: r`**Entities**: **queues** (point to point) and **topics with subscriptions** (pub/sub; each subscription is its own queue with **SQL or correlation filters**). Tiers: Standard (shared) and **Premium** (dedicated messaging units, VNet/private endpoints, zone redundancy, large messages up to 100 MB; Standard is 256 KB).

**Receive modes**
- **Peek-lock** (default): the message is locked for the **lock duration** (default 60 s, max 5 min); the consumer **completes** it after processing, **abandons** it (retry), **dead-letters** it, or **defers** it. If the lock expires, it is redelivered and **DeliveryCount** increments.
- Receive-and-delete: at-most-once; use only for losable data.
- The **processor** renews locks automatically up to {{MaxAutoLockRenewalDuration}} for long work.

**Dead-letter queue (DLQ)**: every queue and subscription has one. Messages land there after **MaxDeliveryCount** (default 10), on TTL expiry (if enabled), filter errors, or explicit dead-lettering with a reason. Monitor and redrive it.

**Duplicate detection**: drops messages with a repeated {{MessageId}} within a window (up to 7 days) — protects against **producer** retries. It does not make the **consumer** exactly-once: a consumer that crashes after the side effect but before completing will see the message again. Consumers stay idempotent.

**Sessions**: messages with the same {{SessionId}} are delivered **in order** to one consumer at a time (FIFO per session, for example per account). Session state lets a consumer store progress. **Transactions** can atomically complete a received message and send new ones within the same namespace.

**Other features**: scheduled messages (delayed delivery), auto-forwarding, message TTL.

**AWS mapping**: queue ≈ SQS (peek-lock ≈ visibility timeout); topic + subscriptions ≈ SNS + SQS fan-out with filters; sessions ≈ SQS FIFO message groups.`,
  code: r`~~~csharp
await using var client = new ServiceBusClient("sb-payments-prod.servicebus.windows.net", credential);
var processor = client.CreateProcessor("settlement-commands", new ServiceBusProcessorOptions
{
    AutoCompleteMessages = false,
    MaxConcurrentCalls = 16,
    PrefetchCount = 32,
    MaxAutoLockRenewalDuration = TimeSpan.FromMinutes(10)   // long work keeps its lock
});

processor.ProcessMessageAsync += async args =>
{
    var msg = args.Message;
    try
    {
        await handler.HandleAsync(msg.MessageId, msg.Body.ToObjectFromJson<SettleCommand>(), args.CancellationToken); // idempotent
        await args.CompleteMessageAsync(msg);
    }
    catch (ValidationException ex)
    {
        await args.DeadLetterMessageAsync(msg, "ValidationFailed", ex.Message);   // permanent: do not retry
    }
    // transient exceptions: let the lock expire or abandon; DeliveryCount drives eventual dead-lettering
};
processor.ProcessErrorAsync += e => { logger.LogError(e.Exception, "Service Bus error {Source}", e.ErrorSource); return Task.CompletedTask; };
await processor.StartProcessingAsync();
~~~`,
  dia: r`flowchart LR
  P[Producer - MessageId = business id] --> T{{Topic: payments}}
  T -->|filter region = EU| S1[(Sub: eu-ledger)]
  T -->|all| S2[(Sub: notifications)]
  S1 -->|peek-lock| C1[Ledger consumer]
  C1 -->|complete| S1
  S1 -->|MaxDeliveryCount exceeded| D1[(eu-ledger DLQ)]`,
  pts: [r`Queues for point to point; topics with filtered subscriptions for pub/sub.`, r`Peek-lock with complete, abandon, dead-letter, defer; auto lock renewal for long work.`, r`DLQ after MaxDeliveryCount; monitor and redrive.`, r`Duplicate detection covers producer retries only; consumers stay idempotent.`, r`Sessions give per-key FIFO; Premium for isolation, private endpoints and large messages.`],
  ex: r`A payments team saw duplicate settlement postings after lock expiry during slow database calls; enabling auto lock renewal and an idempotency table keyed on MessageId stopped them.`,
  fu: [r`How do sessions affect scaling and throughput?`, r`When would you use deferral instead of abandon?`],
  pit: [r`Assuming duplicate detection gives exactly-once processing.`, r`Lock duration shorter than processing time without auto-renewal.`, r`Nobody watching the dead-letter queue.`] },

{ id: 'q15', level: 'Intermediate', tags: ['event-grid', 'event-hubs', 'service-bus', 'messaging-choice'],
  q: r`Event Grid, Event Hubs or Service Bus? Explain each service's model and guarantees, and choose for three scenarios: blob-uploaded notifications, card-transaction telemetry at 50,000 events/s, and payment commands.`,
  a: r`| | Event Grid | Event Hubs | Service Bus |
|---|---|---|---|
| Model | push event routing (discrete events) | partitioned log (streaming) | broker with queues/topics (messages) |
| Payload intent | "something happened" notifications | high-volume telemetry/streams | commands and business messages |
| Delivery | at-least-once push, retry up to 24 h, dead-letter to blob | consumers pull by offset; replay within retention | peek-lock, DLQ, sessions, transactions |
| Ordering | none | per partition | per session |
| Scale | millions of events/s | MB/s per throughput/processing unit | thousands to tens of thousands of msgs/s per namespace |
| AWS analogue | EventBridge | Kinesis / MSK | SQS + SNS (with richer semantics) |

**Scenario choices**
1. **Blob uploaded → process the file**: **Event Grid** system topic on the storage account → subscription to a Function or (better) to a **Service Bus queue** so processing has retries, a DLQ and backpressure.
2. **Card-transaction telemetry at 50,000 events/s** for fraud features and analytics: **Event Hubs** (Kafka-compatible endpoint available), partitioned by card or account id, consumed by Stream Analytics/Flink/Spark and archived by **Capture** to the data lake.
3. **Payment commands** (do exactly this, once, reliably, maybe in order per account): **Service Bus** queue or topic with sessions, duplicate detection, DLQ, idempotent consumers.

**Event Grid details worth knowing**: system topics (Azure resource events), custom topics and **namespaces** (MQTT, pull delivery); CloudEvents 1.0 schema; filtering on event type and subject; endpoint validation handshake for webhooks; configure **dead-lettering** or failed events are dropped after retries.

**Combinations are normal**: Event Grid notifications feeding Service Bus; Service Bus commands producing outcomes published to Event Grid or Event Hubs. The **outbox** pattern remains necessary for reliable publishing from a database transaction.`,
  code: r`~~~csharp
// Event Hubs producer for telemetry: partition by account so per-account order holds
await using var producer = new EventHubProducerClient("eh-payments-prod.servicebus.windows.net", "card-telemetry", credential);
using EventDataBatch batch = await producer.CreateBatchAsync(new CreateBatchOptions { PartitionKey = accountId });
foreach (var e in events)
    if (!batch.TryAdd(new EventData(JsonSerializer.SerializeToUtf8Bytes(e)))) break;   // batch full: send and start another
await producer.SendAsync(batch);

// Event Grid -> Service Bus: blob events land in a queue with retries and a DLQ
// az eventgrid system-topic event-subscription create --name blob-to-sb \
//   --system-topic-name st-docs-topic -g rg-docs --endpoint-type servicebusqueue \
//   --endpoint /subscriptions/<sub>/.../queues/doc-ingest --included-event-types Microsoft.Storage.BlobCreated
~~~`,
  dia: r`flowchart LR
  ST[Blob Storage] -->|BlobCreated| EG[Event Grid system topic]
  EG --> SBQ[(Service Bus queue: doc-ingest)] --> F[Processor]
  SW[Card switch] -->|50k events/s| EH[(Event Hubs: card-telemetry, 32 partitions)]
  EH --> SA[Stream processing: fraud features]
  EH --> CAP[Capture to Data Lake]
  API[Payments API + outbox] --> SBT{{Service Bus topic: payment-commands}}
  SBT --> W[Workers - sessions per account]`,
  pts: [r`Event Grid routes discrete notifications; Event Hubs streams high-volume data; Service Bus carries business messages.`, r`Event Grid retries up to 24 h; configure dead-lettering.`, r`Event Hubs partitions give order and replay within retention.`, r`Service Bus gives peek-lock, DLQ, sessions and transactions for commands.`, r`Combine them; still use an outbox for reliable publishing.`],
  ex: r`A card issuer sent fraud telemetry through Service Bus and hit throughput limits at peak; moving telemetry to Event Hubs and keeping commands on Service Bus fixed both cost and latency.`,
  fu: [r`Why route Event Grid events into Service Bus rather than straight to a Function?`, r`When would you use the Event Hubs Kafka endpoint?`],
  pit: [r`Using Event Hubs as a command queue with per-message retries.`, r`Event Grid subscriptions without dead-lettering.`, r`Using Service Bus for high-volume telemetry.`] },

{ id: 'q16', level: 'Intermediate', tags: ['azure-functions', 'hosting-plans', 'isolated-worker', 'cold-start'],
  q: r`Explain Azure Functions for .NET: hosting plans (Flex Consumption, Premium, Dedicated), the isolated worker model, triggers and bindings, scaling, cold starts and timeouts.`,
  a: r`**Hosting plans**
| Plan | Scale | Cold start | Networking | Notes |
|---|---|---|---|---|
| **Flex Consumption** | event-driven, to zero, per-function scaling, configurable instance memory | yes, mitigated by always-ready instances | VNet integration | recommended for new serverless apps |
| Consumption (classic) | to zero | yes | limited | default timeout 5 min (max 10) |
| **Premium** (Elastic Premium) | event-driven with pre-warmed instances | none for warm instances | VNet integration | unlimited duration option, larger instances |
| Dedicated (App Service plan) | your plan's autoscale | none (Always On) | App Service networking | reuse existing capacity |
| Container Apps | KEDA | depends | Container Apps env | functions as containers |

**HTTP-triggered functions** must answer within about **230 seconds** regardless of plan (the front-end load balancer timeout); longer work goes async (queue + Durable Functions).

**Isolated worker model**: your code runs in a separate .NET process from the Functions host, so you choose the .NET version, use standard DI, middleware and {{HostBuilder}}. The **in-process model reaches end of support in November 2026**, so all new and migrated apps use isolated worker (and ASP.NET Core integration for HTTP).

**Triggers and bindings**: a trigger starts the function (HTTP, Timer, Service Bus, Event Hubs, Event Grid, Blob, Cosmos DB change feed, Queue); input/output bindings read and write declaratively. Bindings are convenient, but for production consider SDK clients when you need control over retries, batching and error handling.

**Scaling behaviour**: the scale controller adds instances based on trigger backlog (queue length, Event Hubs lag). Per-instance concurrency settings ({{maxConcurrentCalls}} for Service Bus, batch size for Event Hubs) multiply with instance count — cap with {{maximumInstanceCount}} (Flex) to protect databases.

**Cold starts in .NET**: runtime start + JIT + DI graph. Mitigate with Flex always-ready instances or Premium pre-warmed instances, ReadyToRun, lean start-up, and avoiding heavy work in constructors.

**Retries**: trigger-specific — Service Bus uses the broker's delivery count and DLQ; Event Hubs needs your own retry or checkpointing strategy (a failure does not stop the partition unless you handle it). Make handlers idempotent.`,
  code: r`~~~csharp
// Isolated worker: Service Bus-triggered function with manual settlement for clear failure handling
public sealed class SettlementFunction(ILedgerService ledger, ILogger<SettlementFunction> log)
{
    [Function(nameof(SettlementFunction))]
    public async Task Run(
        [ServiceBusTrigger("settlement-commands", Connection = "ServiceBus", AutoCompleteMessages = false)]
        ServiceBusReceivedMessage message, ServiceBusMessageActions actions, CancellationToken ct)
    {
        try
        {
            await ledger.SettleAsync(message.MessageId, message.Body.ToObjectFromJson<SettleCommand>(), ct); // idempotent
            await actions.CompleteMessageAsync(message, ct);
        }
        catch (ValidationException ex)
        {
            await actions.DeadLetterMessageAsync(message, deadLetterReason: "Invalid", deadLetterErrorDescription: ex.Message, cancellationToken: ct);
        }
    }
}

// Program.cs
var host = new HostBuilder()
    .ConfigureFunctionsWebApplication()
    .ConfigureServices(s => s.AddSingleton<ILedgerService, LedgerService>())
    .Build();
await host.RunAsync();
// "ServiceBus__fullyQualifiedNamespace": "sb-payments-prod.servicebus.windows.net"  -> identity-based connection
~~~`,
  dia: r`flowchart LR
  SB[(Service Bus queue)] -->|backlog| SC[Scale controller]
  SC -->|add instances, max 20| I1[Function instance]
  SC --> I2[Function instance]
  I1 --> DB[(Azure SQL)]
  I2 --> DB
  HTTP[HTTP request] -->|over 230 s?| Q[(Queue)] --> DF[Durable orchestration]`,
  pts: [r`Flex Consumption for new serverless; Premium for warm instances; Dedicated to reuse plans.`, r`HTTP functions must respond within about 230 seconds; go async for long work.`, r`Isolated worker model; in-process ends support in November 2026.`, r`Scale = instances x per-instance concurrency; cap to protect downstream.`, r`Identity-based connections, idempotent handlers, trigger-specific retry semantics.`],
  ex: r`A reconciliation function on Consumption timed out at 10 minutes on month-end files; moving to a queue-driven Durable Functions fan-out on Flex Consumption finished in 6 minutes with no timeouts.`,
  fu: [r`What changes when migrating from in-process to isolated worker?`, r`How do you stop an Event Hubs-triggered function from silently skipping failed events?`],
  pit: [r`New functions on the in-process model.`, r`Long synchronous HTTP functions.`, r`Unbounded scale-out against a relational database.`] },

{ id: 'q17', level: 'Intermediate', tags: ['api-management', 'policies', 'rate-limiting'],
  q: r`Design API Management for partner and internal APIs: tiers, products and subscriptions, policies (JWT validation, rate limits, transformations), network modes, the self-hosted gateway, and versioning.`,
  a: r`**What APIM is**: a gateway (runtime), a management plane, and a developer portal. Mapping to AWS: API Gateway (REST API) with usage plans and a developer portal.

**Tiers**: Developer (no SLA), Basic/Standard/Premium (classic), and the **v2 tiers** (Basic v2, Standard v2, Premium v2) with faster provisioning and VNet integration options. **Premium** adds multi-region gateways, availability zones and full VNet injection. Choose by network isolation, SLA and multi-region needs.

**Products and subscriptions**: a product groups APIs with terms and quotas; a **subscription key** identifies the caller — useful for metering and partner throttling, **not** authentication on its own. Pair it with OAuth 2.0 / mTLS.

**Policies** (XML pipeline: inbound → backend → outbound → on-error), common ones:
- {{validate-jwt}} / {{validate-azure-ad-token}}: issuer, audience, signature, required claims.
- {{rate-limit-by-key}} and {{quota-by-key}}: per partner or per subscription; return 429 with Retry-After.
- {{set-header}}, {{rewrite-uri}}, {{set-backend-service}}, transformations (XML ↔ JSON), {{cache-lookup}}/{{cache-store}}.
- {{authentication-managed-identity}}: APIM calls the backend with its own managed identity.
- {{validate-content}}: schema validation and payload size limits.
Note: in multi-instance or multi-region gateways rate-limit counters are approximate; enforce precise financial limits in the service.

**Network modes**: external (public gateway, private backends), internal (gateway only in the VNet, fronted by App Gateway/Front Door), or private endpoint for inbound.

**Self-hosted gateway**: a container you run on-premises or in another cloud, managed from Azure — keeps traffic local for hybrid APIs.

**Versioning**: **versions** (breaking changes: path {{/v2}}, header or query) and **revisions** (non-breaking changes, testable before making current). Deprecate with Sunset headers and portal notices.

**Ops**: APIM configuration as code (APIOps with Bicep/ARM or Terraform), Application Insights integration, and per-API diagnostics with sampling.`,
  code: r`~~~xml
<!-- Inbound policy: OIDC token, per-partner rate limit, call backend with managed identity -->
<policies>
  <inbound>
    <base />
    <validate-jwt header-name="Authorization" failed-validation-httpcode="401" require-scheme="Bearer">
      <openid-config url="https://login.microsoftonline.com/{tenant-id}/v2.0/.well-known/openid-configuration" />
      <audiences><audience>api://payments-partner-api</audience></audiences>
      <required-claims><claim name="roles" match="any"><value>Payments.Initiate</value></claim></required-claims>
    </validate-jwt>
    <rate-limit-by-key calls="100" renewal-period="1" counter-key="@(context.Subscription.Id)" />
    <quota-by-key calls="500000" renewal-period="86400" counter-key="@(context.Subscription.Id)" />
    <authentication-managed-identity resource="api://payments-backend" />
    <set-header name="X-Correlation-Id" exists-action="skip"><value>@(context.RequestId.ToString())</value></set-header>
  </inbound>
  <backend><base /></backend>
  <outbound><base /></outbound>
  <on-error><base /></on-error>
</policies>
~~~`,
  dia: r`flowchart LR
  PT[Partner] -->|mTLS + JWT + subscription key| FD[Front Door WAF]
  FD --> APIM[APIM gateway: validate-jwt, rate-limit-by-key]
  APIM -->|managed identity token| B1[Payments API]
  APIM --> B2[Statements API]
  DEV[Developer portal] -.products, keys, docs.-> PT
  SHG[Self-hosted gateway - on-prem] --> LEG[Legacy core API]`,
  pts: [r`APIM = gateway + management plane + developer portal.`, r`Subscription keys meter callers; authenticate with OAuth or mTLS.`, r`Policies: validate-jwt, rate-limit-by-key, quota, managed identity to backends.`, r`Choose network mode and tier by isolation, SLA and multi-region needs.`, r`Versions for breaking changes, revisions for safe changes; APIOps as code.`],
  ex: r`A bank exposed open-banking APIs through APIM Premium in two regions with per-TPP quotas; a misbehaving third-party provider was throttled at 100 rps without affecting other partners.`,
  fu: [r`Why are distributed rate limits approximate, and where do you enforce exact limits?`, r`How would you migrate partners from v1 to v2 of an API?`],
  pit: [r`Using subscription keys as the only authentication.`, r`Portal-click configuration with no source control.`, r`Business logic in gateway policies.`] },

{ id: 'q18', level: 'Intermediate', tags: ['azure-monitor', 'application-insights', 'kql', 'opentelemetry'],
  q: r`Instrument .NET services with Azure Monitor and Application Insights: workspace-based resources, the OpenTelemetry distro, sampling, KQL investigation, alerts and cost control.`,
  a: r`**Building blocks**
- **Log Analytics workspace**: the store for logs and (workspace-based) Application Insights telemetry; queried with **KQL**.
- **Application Insights**: application performance monitoring — requests, dependencies, exceptions, traces, application map, live metrics, availability tests.
- **Azure Monitor metrics**: platform metrics per resource; **diagnostic settings** route resource logs (Key Vault, SQL, Front Door) to a workspace, storage or Event Hubs.
- **Alerts**: metric, log (KQL) and activity-log alerts, with **action groups** (email, SMS, webhook, ITSM, Logic App).

**Instrumentation**: use the **Azure Monitor OpenTelemetry Distro** ({{Azure.Monitor.OpenTelemetry.AspNetCore}}): one call ({{UseAzureMonitor()}}) wires traces, metrics and logs with W3C trace context. Add custom {{ActivitySource}} spans and meters for business operations. Classic Application Insights SDKs are legacy for new code.

**Sampling**: telemetry volume drives cost. Use rate-limited or fixed-rate sampling on traces while keeping metrics pre-aggregated; never sample away the signal you alert on. Capture 100% of failed requests if possible.

**Correlation across async hops**: propagate {{traceparent}} via Service Bus/Event Hubs application properties; the SDKs do this for supported clients.

**Alert on symptoms**: SLO-based alerts (availability and p95/p99 latency per operation), Service Bus DLQ count > 0 and active message age, SQL DTU/CPU saturation, 429s from Cosmos DB, SNAT port usage on App Service.

**Cost control**: daily caps (as a safety net, not a plan), sampling, basic/auxiliary log tables for verbose logs, data collection rules to filter at ingestion, commitment tiers for large volumes, per-table retention, and archive for long-term audit.

**Audit vs telemetry**: the **Activity Log** records control-plane operations (who changed the NSG); export it centrally with long retention. Application logs are not an audit trail.

**AWS mapping**: Application Insights ≈ X-Ray + CloudWatch Application Signals; Log Analytics + KQL ≈ CloudWatch Logs Insights; Activity Log ≈ CloudTrail.`,
  code: r`~~~csharp
builder.Services.AddOpenTelemetry()
    .UseAzureMonitor(o => { o.SamplingRatio = 0.25f; })            // APPLICATIONINSIGHTS_CONNECTION_STRING from config
    .WithTracing(t => t.AddSource("Payments"));

private static readonly ActivitySource Source = new("Payments");
public async Task<AuthResult> AuthorizeAsync(PaymentRequest req, CancellationToken ct)
{
    using var activity = Source.StartActivity("Authorize");
    activity?.SetTag("payment.method", req.Method);               // low-cardinality tags only
    return await _psp.AuthorizeAsync(req, ct);
}
~~~
~~~text
// KQL: p99 latency and failure rate per operation in the last hour, 5-minute bins
requests
| where timestamp > ago(1h)
| summarize p99 = percentile(duration, 99), failures = countif(success == false), total = count()
    by operation_Name, bin(timestamp, 5m)
| extend failureRate = round(100.0 * failures / total, 2)
| order by p99 desc
~~~`,
  dia: r`flowchart LR
  APP[.NET service - OTel distro] -->|traces, metrics, logs| AI[Application Insights]
  AI --> LAW[(Log Analytics workspace)]
  RES[Azure resources] -->|diagnostic settings| LAW
  ACT[Activity Log] --> LAW
  LAW --> AL[KQL / metric alerts: SLO burn, DLQ, 429s]
  AL --> AG[Action group: PagerDuty, Teams]`,
  pts: [r`Workspace-based Application Insights plus diagnostic settings into Log Analytics.`, r`Use the Azure Monitor OpenTelemetry distro with custom spans.`, r`Sample traces wisely; keep failures and alert signals.`, r`Alert on SLOs and saturation; route via action groups.`, r`Control cost with sampling, DCR filtering, table plans and retention.`],
  ex: r`A trading platform cut Application Insights cost by 55% with 25% sampling of successful requests and basic logs for verbose traces, while keeping 100% of failures for incident analysis.`,
  fu: [r`How do you correlate a request across Service Bus to a background worker?`, r`What is the danger of a daily cap during an incident?`],
  pit: [r`High-cardinality custom dimensions on metrics.`, r`Relying on the daily cap to control cost.`, r`Treating application logs as the audit trail.`] },

{ id: 'q19', level: 'Senior', tags: ['durable-functions', 'saga', 'orchestration'],
  q: r`Use Durable Functions to orchestrate a payment saga with compensation, external approval and fan-out. Explain event sourcing and replay, the determinism rules, and how this compares with Step Functions.`,
  a: r`**How it works**: an **orchestrator** function describes the workflow in code; **activity** functions do the work. The Durable Task Framework records every step as events in a **history** (Azure Storage by default; Netherite, MSSQL or the **Durable Task Scheduler** backend as alternatives). When an activity completes, the orchestrator **replays from the beginning**, using recorded results instead of re-executing completed activities, until it reaches new work.

**Determinism rules (the interview core)**: because of replay, orchestrator code must be deterministic:
- no {{DateTime.UtcNow}} → use {{context.CurrentUtcDateTime}};
- no {{Guid.NewGuid()}} → {{context.NewGuid()}};
- no direct I/O (HTTP, database) → call an activity;
- no {{Task.Delay}} → {{CreateTimer}};
- no non-deterministic threading APIs; versioning changes carefully (changing step order breaks in-flight instances).

**Patterns**
- **Function chaining with compensation**: try/catch around steps; on failure call compensations in reverse order with retry policies.
- **Fan-out/fan-in**: start many activities, {{Task.WhenAll}} — for reconciling thousands of settlement files.
- **Human interaction / external events**: {{WaitForExternalEvent("SanctionsCleared")}} raced against a durable timer for escalation.
- **Monitor** and **eternal orchestrations** ({{ContinueAsNew}} to keep history small).
- **Durable entities** for small stateful objects (counters, limits).

**Idempotency**: activities are at-least-once (a crash after an activity's side effect but before its result is recorded re-runs it). Pass the instance id plus step name as the idempotency key to downstream calls. Use the payment id as the **instance id** so a duplicate start is detected.

**Versus AWS Step Functions**: Step Functions is a declarative JSON/ASL state machine with a visual console and native service integrations; Durable Functions is code-first (.NET, testable, type-safe) with replay constraints. Both need idempotent steps and compensations. Choose by team preference and ecosystem: code-first teams like Durable; ops/audit teams like the visual history of Step Functions.`,
  code: r`~~~csharp
[Function(nameof(PaymentSaga))]
public static async Task<string> PaymentSaga([OrchestrationTrigger] TaskOrchestrationContext ctx)
{
    var req = ctx.GetInput<PaymentRequest>()!;
    var retry = TaskOptions.FromRetryPolicy(new RetryPolicy(5, TimeSpan.FromSeconds(2), backoffCoefficient: 2));

    await ctx.CallActivityAsync("ReserveFunds", req, retry);
    try
    {
        using var cts = new CancellationTokenSource();
        var cleared = ctx.WaitForExternalEvent<bool>("SanctionsDecision");
        var timeout = ctx.CreateTimer(ctx.CurrentUtcDateTime.AddHours(4), cts.Token);   // deterministic time
        if (await Task.WhenAny(cleared, timeout) == timeout || !cleared.Result)
            throw new InvalidOperationException("Sanctions not cleared");
        cts.Cancel();

        await ctx.CallActivityAsync("Capture", req, retry);
        await ctx.CallActivityAsync("PublishOutcome", new Outcome(req.PaymentId, "COMPLETED"));
        return "COMPLETED";
    }
    catch (Exception)
    {
        await ctx.CallActivityAsync("ReleaseFunds", req, TaskOptions.FromRetryPolicy(new RetryPolicy(20, TimeSpan.FromSeconds(5))));
        await ctx.CallActivityAsync("PublishOutcome", new Outcome(req.PaymentId, "FAILED"));
        return "FAILED";
    }
}
// Start with instanceId = paymentId so duplicate starts are detected:
// await client.ScheduleNewOrchestrationInstanceAsync(nameof(PaymentSaga), req, new StartOrchestrationOptions(req.PaymentId));
~~~`,
  dia: r`sequenceDiagram
  participant O as Orchestrator
  participant H as History store
  participant A as Activities
  O->>A: ReserveFunds
  A-->>H: result recorded
  H-->>O: replay from start, ReserveFunds = done
  O->>O: wait SanctionsDecision or 4h timer
  O->>A: Capture
  A-->>H: failed
  H-->>O: replay, exception surfaces
  O->>A: ReleaseFunds - compensation, retried`,
  pts: [r`Orchestrators replay from history; activities do the I/O.`, r`Determinism: context time, context GUIDs, timers, no direct I/O.`, r`Compensation via try/catch in reverse order with retries.`, r`External events raced with durable timers for human steps.`, r`Instance id = business id; activities are at-least-once, so keep them idempotent.`],
  ex: r`A team called DateTime.UtcNow inside an orchestrator; replays computed different deadlines and payments stalled until they switched to context.CurrentUtcDateTime and redeployed with versioned orchestrator names.`,
  fu: [r`How do you deploy a breaking change to an orchestrator with thousands of in-flight instances?`, r`When would you pick Logic Apps instead?`],
  pit: [r`Non-deterministic code in orchestrators.`, r`Non-idempotent activities.`, r`Unbounded history from eternal loops without ContinueAsNew.`] },

{ id: 'q20', level: 'Senior', tags: ['aks', 'kubernetes', 'networking', 'workload-identity'],
  q: r`Operate .NET workloads on AKS: networking models (Azure CNI Overlay versus others), node pools and autoscaling, workload identity, ingress options, upgrades and AKS Automatic.`,
  a: r`**Responsibility split**: AKS manages the control plane (free tier or Standard tier with an uptime SLA, plus Premium for long-term support). You own node pools, add-ons, upgrades, networking design and workloads — unless you choose **AKS Automatic**, which preconfigures node autoprovisioning, security defaults and managed upgrades.

**Networking models**
- **Azure CNI Overlay** (common default): pods get IPs from a private overlay CIDR, not the VNet. Saves VNet address space; pods reach VNet resources via node SNAT. Good for most clusters.
- **Azure CNI (VNet / pod subnet)**: pods get real VNet IPs — needed when external systems must reach pods directly; plan large subnets.
- **Kubenet** is being retired (2028) — migrate to CNI Overlay.
- **Azure CNI powered by Cilium**: eBPF dataplane, network policy and observability.
- Outbound: NAT Gateway or user-defined routing through Azure Firewall; private cluster API server for regulated estates.

**Node pools and autoscaling**: a **system pool** (CoreDNS, metrics; tainted for system workloads) and **user pools** per workload class (general, memory-optimised, spot, GPU). **Cluster autoscaler** or **node autoprovisioning** (Karpenter-based) adds nodes; HPA/KEDA scale pods. Spread pools across zones; set PodDisruptionBudgets.

**Workload identity**: a Kubernetes service account federated to a **user-assigned managed identity** via the cluster's OIDC issuer; pods use {{DefaultAzureCredential}} with no secrets. Replaces the deprecated pod-managed identity.

**Ingress options**: Application Gateway for Containers (Gateway API), the application routing add-on (managed NGINX), or your own controller; Front Door in front for global entry.

**Upgrades**: Kubernetes minor versions get roughly 12 months of community-based support in AKS; use auto-upgrade channels (patch/stable) and **planned maintenance windows**, node image auto-upgrade for OS patches, surge settings for node upgrades, and test against deprecated APIs. Blue/green clusters for risky jumps.

**.NET specifics**: container-aware GC, sensible CPU requests (avoid tiny CPU limits that cause thread-pool starvation), graceful shutdown on SIGTERM, readiness vs liveness probes.

**AWS mapping**: AKS ≈ EKS; CNI Overlay ≈ VPC CNI with custom networking; workload identity ≈ EKS Pod Identity/IRSA; node autoprovisioning ≈ Karpenter.`,
  code: r`~~~yaml
# Workload identity: service account federated to a user-assigned managed identity
apiVersion: v1
kind: ServiceAccount
metadata:
  name: payments-api
  namespace: payments
  annotations:
    azure.workload.identity/client-id: "00000000-1111-2222-3333-444444444444"
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: payments-api, namespace: payments }
spec:
  replicas: 3
  selector: { matchLabels: { app: payments-api } }
  template:
    metadata:
      labels: { app: payments-api, azure.workload.identity/use: "true" }
    spec:
      serviceAccountName: payments-api
      topologySpreadConstraints:
        - { maxSkew: 1, topologyKey: topology.kubernetes.io/zone, whenUnsatisfiable: DoNotSchedule, labelSelector: { matchLabels: { app: payments-api } } }
      containers:
        - name: api
          image: acrpayments.azurecr.io/payments-api@sha256:4f1c...
          resources: { requests: { cpu: "500m", memory: "512Mi" }, limits: { memory: "1Gi" } }
          readinessProbe: { httpGet: { path: /health/ready, port: 8080 } }
          livenessProbe:  { httpGet: { path: /health/live,  port: 8080 } }
# az identity federated-credential create --name payments-api --identity-name id-payments-api -g rg-aks \
#   --issuer "$AKS_OIDC_ISSUER" --subject system:serviceaccount:payments:payments-api
~~~`,
  dia: r`flowchart TB
  FD[Front Door] --> AGC[App Gateway for Containers]
  subgraph AKS[AKS - CNI Overlay, private API server]
    SYS[System pool - zones 1-3]
    USR[User pool - zones 1-3]
    P1[payments-api pods]
  end
  AGC --> P1
  USR --- P1
  P1 -->|workload identity token| ENTRA[Entra ID]
  P1 --> KV[Key Vault via private endpoint]
  AKS -->|egress UDR| FW[Azure Firewall]`,
  pts: [r`AKS manages the control plane; you own pools, upgrades and networking unless AKS Automatic.`, r`CNI Overlay saves VNet IPs; kubenet is being retired.`, r`System and user pools across zones; cluster autoscaler or node autoprovisioning.`, r`Workload identity federates service accounts to managed identities.`, r`Planned maintenance, auto-upgrade channels and deprecated-API checks for upgrades.`],
  ex: r`A bank ran out of VNet addresses with Azure CNI on a /22 pod subnet at quarter-end; migrating to CNI Overlay removed pod IPs from the VNet and freed space for new spokes.`,
  fu: [r`When must pods have routable VNet IPs?`, r`How do you upgrade AKS with zero downtime for stateful workloads?`],
  pit: [r`Running user workloads on the system pool.`, r`Using deprecated pod-managed identity.`, r`Skipping upgrades until the version falls out of support.`] },

{ id: 'q21', level: 'Senior', tags: ['container-apps', 'keda', 'dapr', 'revisions'],
  q: r`Azure Container Apps in depth: environments, revisions and traffic splitting, KEDA scaling to zero, Dapr, jobs, networking and identity. When does it beat AKS, and when does it fall short?`,
  a: r`**What it is**: a serverless container platform built on Kubernetes, KEDA, Envoy and Dapr, without exposing the Kubernetes API. AWS analogue: somewhere between App Runner and ECS Fargate.

**Core concepts**
- **Environment**: a secure boundary (shared VNet, Log Analytics) for a group of apps. **Workload profiles**: consumption (serverless) and dedicated profiles (reserved VM sizes, GPUs).
- **Container app**: one or more containers with ingress (external or internal), secrets (Key Vault references) and managed identity.
- **Revisions**: immutable snapshots created on template changes. **Multiple-revision mode** splits traffic by weight (canary 10% → 100%) and labels give test URLs; single-revision mode replaces automatically.
- **Scaling**: KEDA-based rules — HTTP concurrency, CPU/memory, or event sources (Service Bus queue length, Event Hubs lag, Kafka, cron). Min replicas 0 enables scale to zero (cold start on first request); set min ≥ 1 for latency-sensitive APIs.
- **Jobs**: manual, scheduled or event-driven run-to-completion tasks (batch, migrations, queue drains).
- **Dapr** (optional sidecar): service invocation with mTLS and retries, pub/sub, state stores, bindings, secrets — portable building-block APIs over Service Bus, Redis, Cosmos DB and others.

**Networking and identity**: custom VNet with internal-only environments, private endpoints, user-defined routes for egress through Azure Firewall; managed identities for ACR pulls and Azure resources.

**Where it beats AKS**: small and mid-size microservice estates, event-driven workers that should scale to zero, teams without Kubernetes expertise, fast setup with canary deployments built in.

**Where it falls short**: no Kubernetes API (no custom operators, CRDs, DaemonSets, Helm charts as-is), limited control over node/network tuning, platform limits per environment and replica, and some advanced service-mesh needs. If you need those, AKS.`,
  code: r`~~~bicep
resource worker 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-settlement-worker'
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '$\{uami.id}': {} } }
  properties: {
    environmentId: cae.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [ { server: 'acrpayments.azurecr.io', identity: uami.id } ]
    }
    template: {
      containers: [ {
        name: 'worker', image: 'acrpayments.azurecr.io/settlement-worker@sha256:9ab3...'
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [ { name: 'AZURE_CLIENT_ID', value: uami.properties.clientId } ]
      } ]
      scale: {
        minReplicas: 0, maxReplicas: 20                       // cap protects the database
        rules: [ {
          name: 'sb-backlog'
          custom: {
            type: 'azure-servicebus'
            metadata: { queueName: 'settlement-commands', namespace: 'sb-payments-prod', messageCount: '100' }
            identity: uami.id
          }
        } ]
      }
    }
  }
}
~~~`,
  dia: r`flowchart LR
  FD[Front Door] --> ENV
  subgraph ENV[Container Apps environment - internal VNet]
    API[payments-api: rev 41 90 percent, rev 42 10 percent]
    WK[settlement-worker: KEDA 0..20]
    JOB[nightly reconciliation job - cron]
  end
  SB[(Service Bus queue)] -->|queue length| WK
  API -->|Dapr pub/sub| SB
  WK --> SQL[(Azure SQL)]`,
  pts: [r`Serverless containers on Kubernetes, KEDA, Envoy and Dapr without the Kubernetes API.`, r`Revisions with weighted traffic give built-in canary releases.`, r`KEDA rules scale on events, including to zero; set minimum replicas for latency-sensitive APIs.`, r`Jobs for batch; Dapr for portable building blocks.`, r`Choose AKS when you need operators, CRDs or deep control.`],
  ex: r`A lender moved 9 queue workers from AKS to Container Apps with Service Bus scale rules; idle workers scaled to zero overnight and compute cost fell by about 45%.`,
  fu: [r`How would you run database migrations as part of a Container Apps release?`, r`What are the risks of scale-to-zero for an API?`],
  pit: [r`Scale to zero on latency-sensitive APIs.`, r`No maximum replicas against a fixed-capacity database.`, r`Choosing Container Apps and then needing CRDs.`] },

{ id: 'q22', level: 'Senior', tags: ['hub-spoke', 'virtual-wan', 'azure-firewall', 'networking'],
  q: r`Design enterprise network topology on Azure: hub-spoke with peering versus Virtual WAN, Azure Firewall and forced tunnelling, DNS, and connecting 50 spoke VNets plus on-premises.`,
  a: r`**Hub-spoke (customer-managed)**
- **Hub VNet** (connectivity subscription): Azure Firewall, VPN/ExpressRoute gateways, Azure DNS Private Resolver, Bastion.
- **Spoke VNets** per workload/environment, **peered** to the hub. VNet peering is **non-transitive**: spoke-to-spoke traffic goes through the hub firewall via UDRs (which also enforces segmentation).
- UDR on spoke subnets: {{0.0.0.0/0 → firewall private IP}} and other spokes' ranges → firewall.
- **Azure Virtual Network Manager** can manage peering topologies and security admin rules at scale.

**Virtual WAN (Microsoft-managed hub)**
- Managed **virtual hubs** per region with built-in transitive routing between VNets, branches (SD-WAN/VPN) and ExpressRoute; hub-to-hub across regions.
- **Secured virtual hub**: Azure Firewall in the hub with **routing intent** to inspect private and internet traffic.
- Less control over hub internals, but far less routing work for large, multi-region, branch-heavy estates.

**Choosing**: hub-spoke for a few regions and custom appliances/routing; Virtual WAN for many regions, many branches and a desire for managed transit.

**Azure Firewall**: stateful, zone-redundant; network and application rules (FQDN filtering for outbound calls to PSPs), threat intelligence; **Premium** adds TLS inspection and IDPS. Firewall Policy as code, shared across hubs.

**DNS**: central privatelink zones linked to the hub; DNS Private Resolver inbound/outbound endpoints; spokes use the hub resolver (or Azure DNS with linked zones). Firewall DNS proxy if FQDN rules must match the same resolution.

**Address planning**: non-overlapping CIDRs from a central IPAM (Azure Virtual Network Manager IPAM or external), including on-premises ranges.

**Cost and limits**: peering is charged per GB both ways; firewall per hour + per GB; inspecting chatty east-west traffic costs real money — segment by trust zone, not every hop.

**AWS mapping**: hub-spoke peering ≈ VPC peering + inspection VPC; Virtual WAN ≈ Transit Gateway (+ Cloud WAN); Azure Firewall ≈ AWS Network Firewall.`,
  code: r`~~~bicep
// Spoke subnet route table: everything leaves via the hub firewall
resource rtSpoke 'Microsoft.Network/routeTables@2024-05-01' = {
  name: 'rt-spoke-payments'
  location: location
  properties: {
    disableBgpRoutePropagation: true
    routes: [
      { name: 'default-to-fw', properties: { addressPrefix: '0.0.0.0/0', nextHopType: 'VirtualAppliance', nextHopIpAddress: hubFirewallPrivateIp } }
      { name: 'spokes-to-fw',  properties: { addressPrefix: '10.32.0.0/12', nextHopType: 'VirtualAppliance', nextHopIpAddress: hubFirewallPrivateIp } }
    ]
  }
}

// Firewall policy: allow outbound only to named PSP endpoints
resource rcg 'Microsoft.Network/firewallPolicies/ruleCollectionGroups@2024-05-01' = {
  parent: fwPolicy
  name: 'payments-egress'
  properties: {
    priority: 200
    ruleCollections: [ {
      ruleCollectionType: 'FirewallPolicyFilterRuleCollection', name: 'psp', priority: 210, action: { type: 'Allow' }
      rules: [ { ruleType: 'ApplicationRule', name: 'psp-apis', sourceAddresses: [ '10.40.0.0/16' ],
                 protocols: [ { protocolType: 'Https', port: 443 } ], targetFqdns: [ 'api.adyen.com', 'api.stripe.com' ] } ]
    } ]
  }
}
~~~`,
  dia: r`flowchart TB
  ONP[On-premises] -->|ExpressRoute + VPN backup| HUB
  subgraph HUB[Hub VNet - connectivity subscription]
    FW[Azure Firewall Premium]
    GW[ER / VPN gateways]
    DNS[DNS Private Resolver]
  end
  S1[Spoke: payments-prod] <-->|peering, UDR to FW| HUB
  S2[Spoke: cards-prod] <-->|peering| HUB
  S3[Spoke: dev] <-->|peering| HUB
  FW --> NET[Internet: PSPs only by FQDN]`,
  pts: [r`Hub-spoke: peering is non-transitive; route spoke traffic through the hub firewall.`, r`Virtual WAN gives managed transitive hubs for many regions and branches.`, r`Azure Firewall with FQDN egress allow lists; Premium for TLS inspection and IDPS.`, r`Central DNS with Private Resolver and privatelink zones in the hub.`, r`Plan CIDRs centrally; inspect by trust zone to control cost.`],
  ex: r`An insurer with 70 spokes and 40 branches moved from hand-built hub-spoke to Virtual WAN with routing intent; route-table changes per new spoke went from a day of work to zero.`,
  fu: [r`How do you route spoke-to-spoke traffic through a firewall without asymmetric routing?`, r`When is Virtual WAN overkill?`],
  pit: [r`Assuming peering is transitive.`, r`Overlapping address spaces with on-premises.`, r`Inspecting every east-west flow and paying for it.`] },

{ id: 'q23', level: 'Senior', tags: ['landing-zones', 'azure-policy', 'subscription-vending'],
  q: r`Design an Azure landing zone for a regulated firm: management group hierarchy, Azure Policy effects and initiatives, subscription vending, and how policy remediation works.`,
  a: r`**Azure landing zone (ALZ) reference hierarchy**
- Tenant root → **Intermediate root** (your org) →
  - **Platform**: Management (Log Analytics, automation), Connectivity (hub, DNS, firewall), Identity (domain controllers if needed), Security.
  - **Landing zones**: **Corp** (internal, private connectivity) and **Online** (internet-facing), optionally Confidential/PCI.
  - **Sandbox** (isolated, budgets), **Decommissioned**.
- One subscription per workload per environment, placed under the right management group so it inherits policy and RBAC.

**Azure Policy effects**
| Effect | Does |
|---|---|
| **Deny** | blocks non-compliant create/update (public IPs in Corp, non-EU regions, storage with public access) |
| **Audit** / AuditIfNotExists | reports non-compliance |
| **Modify** | adds/changes properties (tags, disabling public network access) on create/update |
| **DeployIfNotExists (DINE)** | deploys related resources (diagnostic settings, private DNS records, Defender plans) |
| **Append**, **Disabled**, **DenyAction** | add fields, switch off, block deletes |

**Initiatives** group policies (for example a PCI DSS or data-residency initiative) with parameters; assign at management group scope with **exemptions** (time-bound, with reasons) where needed.

**Remediation**: Modify and DINE apply to **new** resources automatically; **existing** non-compliant resources need a **remediation task**, which runs with the assignment's **managed identity** — it must hold the RBAC roles to make the change. Compliance scans run periodically and on change.

**Rollout safely**: start policies in Audit (or {{enforcementMode: DoNotEnforce}}), measure impact, then switch to Deny/DINE; test in a canary management group first. Policy as code in Git (EPAC — Enterprise Policy as Code — or Bicep/Terraform) with pull-request review.

**Subscription vending**: a pipeline (Bicep/Terraform modules) that creates a subscription, places it in the right management group, peers a spoke VNet to the hub, assigns RBAC groups and budgets, and applies tags — in under an hour, from a request.

**AWS mapping**: ALZ ≈ Control Tower landing zone; management groups ≈ OUs; Deny policies ≈ SCPs; Audit/DINE ≈ Config rules with remediation; subscription vending ≈ Account Factory.`,
  code: r`~~~json
{
  "properties": {
    "displayName": "Deny public network access on PaaS in Corp landing zones",
    "mode": "Indexed",
    "parameters": { "effect": { "type": "String", "allowedValues": ["Audit", "Deny", "Disabled"], "defaultValue": "Audit" } },
    "policyRule": {
      "if": {
        "allOf": [
          { "field": "type", "equals": "Microsoft.Storage/storageAccounts" },
          { "field": "Microsoft.Storage/storageAccounts/publicNetworkAccess", "notEquals": "Disabled" }
        ]
      },
      "then": { "effect": "[parameters('effect')]" }
    }
  }
}
~~~
~~~bash
# Assign at the Corp management group in Audit first, then switch to Deny after impact review
az policy assignment create --name deny-public-storage --scope /providers/Microsoft.Management/managementGroups/corp \
  --policy deny-public-storage --params '{ "effect": { "value": "Audit" } }'
~~~`,
  dia: r`flowchart TB
  ROOT[Intermediate root: policy - allowed regions EU, required tags]
  ROOT --> PLAT[Platform]
  ROOT --> LZ[Landing zones: Defender on, diagnostics DINE]
  ROOT --> SB[Sandbox: budgets]
  PLAT --> MGMT[Management]
  PLAT --> CONN[Connectivity: hub, DNS]
  LZ --> CORP[Corp: deny public IPs and public PaaS]
  LZ --> ONL[Online: WAF required]
  CORP --> SUB[Vended subscription: payments-prod]
  VEND[Vending pipeline] --> SUB`,
  pts: [r`ALZ hierarchy: Platform, Landing zones (Corp/Online), Sandbox, Decommissioned.`, r`Policy effects: Deny, Audit, Modify, DeployIfNotExists, DenyAction.`, r`Initiatives bundle policies; exemptions are time-bound.`, r`Remediation tasks fix existing resources via the assignment's managed identity.`, r`Roll out Audit first, policy as code, subscription vending pipeline.`],
  ex: r`A bank turned on a Deny policy for public storage directly in production and broke three deployments; it now stages every policy in Audit in a canary management group for two weeks.`,
  fu: [r`Why does a DeployIfNotExists remediation fail with authorisation errors?`, r`How do you handle a legitimate exception to a Deny policy?`],
  pit: [r`Deny policies rolled out without an audit phase.`, r`Remediation identities without the needed roles.`, r`Workloads in platform subscriptions.`] },

{ id: 'q24', level: 'Senior', tags: ['defender-for-cloud', 'sentinel', 'incident-response'],
  q: r`Build cloud security posture and threat detection on Azure with Defender for Cloud and Microsoft Sentinel. Walk through responding to an alert that a managed identity's token is being used from an unusual location.`,
  a: r`**Defender for Cloud**
- **CSPM**: secure score, recommendations, regulatory compliance dashboards (PCI DSS, ISO 27001, CIS), attack-path analysis (Defender CSPM plan).
- **Workload protection plans**: Defender for Servers, Containers (AKS runtime, image scanning), Storage (malware scanning), SQL, Key Vault, App Service, Resource Manager, APIs.
- Enable at scale with Azure Policy across landing-zone management groups.

**Microsoft Sentinel**: cloud-native SIEM/SOAR on a Log Analytics workspace. Data connectors (Entra ID sign-in and audit logs, Activity Log, Defender alerts, firewall logs, Office 365), **analytics rules** (KQL detections), incidents, **playbooks** (Logic Apps) for automated response, workbooks and hunting.

**Identity signals**: Microsoft Entra ID Protection (risky sign-ins, risky workload identities), **Conditional Access for workload identities** (restrict service principals by location), Entra sign-in logs for service principals and managed identities.

**Responding to a suspicious managed identity token use**
1. **Triage**: Sentinel incident shows the identity, resource, source IP and operations. Check Activity Log and resource logs: what did the token do (list keys, read secrets, role assignments)?
2. **Contain the identity**: remove or narrow its **role assignments** (tokens remain valid until expiry — typically up to 24 hours for managed identity tokens, cached by the SDK — so act on authorisation, not just identity). For a service principal: disable it, revoke secrets/certificates, block with Conditional Access for workload identities.
3. **Contain the source**: a leaked managed identity token usually means code execution on the host (SSRF to the identity endpoint, compromised container). Isolate the workload (NSG deny, scale to zero, stop the app), snapshot disks or capture container images for forensics.
4. **Rotate exposed secrets** the identity could read (Key Vault), check for persistence (new role assignments, app registrations, federated credentials, automation accounts).
5. **Recover and learn**: redeploy from known-good artefacts, fix the root cause (SSRF validation, egress restrictions), add detections, assess regulatory notification.

**Automate** containment of high-confidence detections with playbooks, keeping human approval for destructive production actions.`,
  code: r`~~~text
// Sentinel analytics rule (KQL): managed identity sign-ins from IPs outside our Azure egress ranges
let knownEgress = dynamic(["20.50.0.0/16", "51.124.0.0/16"]);   // NAT Gateway / Firewall public prefixes
AADManagedIdentitySignInLogs
| where TimeGenerated > ago(1h)
| where not(ipv4_is_in_any_range(IPAddress, knownEgress))
| summarize attempts = count(), resources = make_set(ResourceDisplayName) by ServicePrincipalName, IPAddress, bin(TimeGenerated, 10m)
~~~
~~~bash
# Containment: remove the identity's role assignments on production scopes (tokens alone are useless without roles)
az role assignment list --assignee <principal-id> --all --query "[].id" -o tsv | xargs -I{} az role assignment delete --ids {}
~~~`,
  dia: r`flowchart LR
  LOGS[Entra sign-in logs, Activity Log, Defender alerts, firewall logs] --> SEN[Sentinel workspace]
  SEN -->|analytics rule| INC[Incident]
  INC --> PB[Logic App playbook]
  PB -->|1| RA[Remove role assignments]
  PB -->|2| ISO[Isolate workload: NSG deny / stop app]
  PB -->|3| TKT[Page on-call + ticket]
  DFC[Defender for Cloud: CSPM + workload plans] --> SEN`,
  pts: [r`Defender for Cloud = posture management plus workload protection plans.`, r`Sentinel = SIEM/SOAR on Log Analytics with analytics rules and playbooks.`, r`Contain identities by removing authorisation; issued tokens remain valid until expiry.`, r`A leaked managed identity token implies host compromise: isolate and preserve evidence.`, r`Check persistence: new roles, app registrations, federated credentials.`],
  ex: r`An SSRF in a PDF renderer let an attacker fetch a managed identity token; removing its role assignments within 9 minutes, driven by a Sentinel playbook, limited exposure to two secret reads, which were then rotated.`,
  fu: [r`How do Conditional Access policies for workload identities help?`, r`What evidence would you collect before redeploying a compromised container?`],
  pit: [r`Assuming disabling an identity instantly invalidates issued tokens.`, r`Redeploying before preserving evidence.`, r`Enabling Defender plans in only some subscriptions.`] },

{ id: 'q25', level: 'Senior', tags: ['bicep', 'terraform', 'iac', 'deployment-stacks'],
  q: r`Bicep, ARM templates or Terraform for Azure? Explain state, what-if previews, deployment scopes, deployment stacks, modules, and protecting stateful resources.`,
  a: r`| | ARM JSON | Bicep | Terraform (azurerm/azapi) |
|---|---|---|---|
| Language | verbose JSON | concise DSL, transpiles to ARM | HCL |
| State | none — ARM is the state (desired vs actual per deployment) | same | state file you store and lock (Azure Storage backend) |
| New Azure features | day one | day one | azurerm provider lag; **azapi** provider for day-one API coverage |
| Preview | {{what-if}} | {{what-if}} | {{terraform plan}} |
| Scope | Azure only | Azure only | multi-cloud and SaaS |

**Choosing**: Azure-only estates often pick **Bicep** (no state file to protect, first-party support, **Azure Verified Modules**). Organisations spanning AWS, Azure and SaaS (GitHub, Datadog) pick **Terraform**. Do not mix within one layer without clear ownership.

**Deployment scopes**: resource group, subscription, management group, tenant — policy assignments and subscription-level resources need higher scopes.

**Deployment modes**: **Incremental** (default) adds/updates and leaves unmanaged resources alone; **Complete** deletes anything in the resource group not in the template — dangerous, rarely right.

**Deployment stacks** (Bicep/ARM): manage a set of resources as a unit with {{actionOnUnmanage}} (detach or delete resources removed from the template) and **deny settings** ({{denyDelete}}, {{denyWriteAndDelete}}) that create deny assignments so nobody — even Owners, unless excluded — can delete or change protected resources outside the pipeline. This is Azure's answer to drift and accidental deletion.

**Protecting stateful resources**: resource locks (CanNotDelete), deployment-stack deny settings, SQL/Cosmos backup retention, Key Vault purge protection; review what-if/plan output in pull requests and block on deletions or replacements; Terraform {{prevent_destroy}} lifecycle.

**Drift**: portal changes in production are the usual cause — read-only portal access in prod (PIM for break-glass), scheduled what-if/plan runs to detect drift, and Azure Policy to enforce what matters.

**Testing**: Bicep linter, PSRule for Azure or Checkov in CI, what-if as a gate, ephemeral environments for integration tests.

**AWS mapping**: Bicep ≈ CDK/CloudFormation (provider-managed state); deployment stacks ≈ CloudFormation stacks with termination protection and stack policies.`,
  code: r`~~~bicep
// main.bicep - subscription scope, Azure Verified Module for the SQL server
targetScope = 'subscription'
param location string = 'westeurope'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-payments-prod-weu'
  location: location
  tags: { owner: 'payments', env: 'prod', costCenter: 'CC-410' }
}

module sql 'br/public:avm/res/sql/server:0.10.0' = {
  scope: rg
  name: 'sql'
  params: {
    name: 'sql-payments-prod'
    location: location
    administrators: { azureADOnlyAuthentication: true, login: 'grp-sql-admins', sid: sqlAdminGroupId, principalType: 'Group' }
    publicNetworkAccess: 'Disabled'
    databases: [ { name: 'ledger', skuName: 'BC_Gen5', skuCapacity: 4, zoneRedundant: true } ]
  }
}
~~~
~~~bash
az deployment sub what-if -l westeurope -f main.bicep                     # gate in the pull request
az stack sub create --name payments-prod -l westeurope -f main.bicep \
  --action-on-unmanage detachAll --deny-settings-mode denyDelete \
  --deny-settings-excluded-principals <pipeline-sp-object-id>
~~~`,
  dia: r`flowchart LR
  PR[Pull request] --> LINT[Bicep lint + PSRule]
  LINT --> WI[what-if output posted to PR]
  WI -->|approved, no deletes of stateful resources| DS[Deployment stack: denyDelete]
  DS --> AZ[(Subscription resources)]
  SCH[Nightly what-if] -->|drift found| T[Ticket to owner]`,
  pts: [r`Bicep for Azure-only (no state file); Terraform for multi-cloud; azapi for new APIs.`, r`what-if/plan reviewed in PRs; avoid Complete mode.`, r`Deployment stacks with deny settings stop out-of-band deletes.`, r`Locks, purge protection and backup retention for stateful resources.`, r`Read-only prod portal and scheduled drift detection.`],
  ex: r`A Complete-mode deployment deleted a manually created private endpoint and took a reporting service offline; the team switched to Incremental mode plus deployment stacks with denyDelete.`,
  fu: [r`How do you import existing portal-created resources into Bicep or Terraform?`, r`Where do you store and protect Terraform state on Azure?`],
  pit: [r`Complete deployment mode against shared resource groups.`, r`Portal hotfixes in production.`, r`Ignoring what-if output.`] },

{ id: 'q26', level: 'Senior', tags: ['cicd', 'workload-identity-federation', 'github-actions', 'azure-devops'],
  q: r`Design CI/CD from GitHub Actions or Azure DevOps to Azure with no stored secrets: workload identity federation, environment approvals, building once and promoting, and change-management evidence.`,
  a: r`**No secrets: workload identity federation**
- Create an Entra **app registration or user-assigned managed identity** per environment deployer.
- Add a **federated credential** trusting GitHub's OIDC issuer with a precise subject: {{repo:bank/payments-api:environment:prod}} (or a branch/tag). Azure DevOps service connections support federation the same way.
- The workflow requests an OIDC token, exchanges it for an Entra token ({{azure/login}} with client-id, tenant-id, subscription-id) — no client secret exists to leak or rotate.
- Grant the deployer **least-privilege RBAC** at the target resource group (Contributor on the RG, or narrower custom roles) — not Owner on the subscription.

**Pipeline shape**
1. Build, test, scan (SAST, dependencies, secrets, IaC policy with PSRule/Checkov).
2. Build the container image **once**, tag with the commit SHA, push to **Azure Container Registry**; Defender for Containers scans; sign the image.
3. Deploy to dev by **digest**; integration tests.
4. Promote the same digest to test/UAT and prod. Prod uses **GitHub environment required reviewers** (or Azure DevOps approvals and checks), deployment windows, and a progressive rollout (slot swap, Container Apps revision weights, AKS canary).
5. Post-deploy verification with automatic rollback on SLO alerts.

**ACR access**: workloads pull with managed identity ({{AcrPull}}); disable the ACR admin user; private endpoint for ACR in regulated estates.

**Change-management evidence (SOX/PCI)**: protected branches with mandatory reviews (author cannot approve), environment approvals, immutable pipeline logs linking commit → image digest → deployment → approver, Activity Log of the deployment, emergency change path with retrospective review.

**Supply chain**: pin actions by SHA, minimal {{permissions}} per job, artifact attestations/provenance, deny deployments of unsigned images (Azure Policy for AKS or admission control).`,
  code: r`~~~yaml
# .github/workflows/deploy.yml (excerpt)
permissions: { id-token: write, contents: read }
jobs:
  prod:
    runs-on: ubuntu-latest
    environment: prod                       # required reviewers + wait timer
    steps:
      - uses: azure/login@v2                # pin to a commit SHA in real use
        with:
          client-id: $\{{ vars.AZURE_CLIENT_ID_PROD }}
          tenant-id: $\{{ vars.AZURE_TENANT_ID }}
          subscription-id: $\{{ vars.AZURE_SUBSCRIPTION_ID_PROD }}
      - run: |
          az containerapp update -g rg-payments-prod-weu -n ca-payments-api \
            --image acrpayments.azurecr.io/payments-api@$\{{ needs.build.outputs.digest }} \
            --revision-suffix r$\{{ github.run_number }}
~~~
~~~bash
# Federated credential: only this repo's prod environment can obtain tokens
az ad app federated-credential create --id <app-id> --parameters '{
  "name": "gh-payments-prod",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:bank/payments-api:environment:prod",
  "audiences": ["api://AzureADTokenExchange"] }'
~~~`,
  dia: r`flowchart LR
  GH[GitHub merge] --> B[Build, test, scan]
  B --> ACR[(ACR: image by SHA, signed, scanned)]
  ACR -->|digest| DEV[Dev subscription]
  DEV -->|same digest| UAT[UAT subscription]
  UAT -->|environment reviewers| PRD[Prod: canary revision, auto rollback]
  GH -.OIDC token.-> ENTRA[Entra federated credential]
  ENTRA -.access token.-> PRD`,
  pts: [r`Workload identity federation removes deployment secrets; tight subject claims.`, r`Least-privilege RBAC for deployers at resource-group scope.`, r`Build once, promote the same digest; ACR with managed identity pulls.`, r`Environment approvals and progressive rollout with automatic rollback.`, r`Pipeline logs and Activity Log are the change-management evidence.`],
  ex: r`A bank removed 63 service principal secrets from Azure DevOps by switching every service connection to workload identity federation; secret-expiry outages, previously monthly, stopped.`,
  fu: [r`What is the risk of a federated credential with a wildcard-like subject on any branch?`, r`How do you deploy database migrations in this pipeline?`],
  pit: [r`Service principal secrets stored in pipeline variables.`, r`Owner on the subscription for the deployer.`, r`Rebuilding images per environment.`] },

{ id: 'q27', level: 'Senior', tags: ['cosmos-db', 'hot-partitions', 'change-feed', 'multi-region-writes'],
  q: r`Cosmos DB at scale: diagnosing hot partitions, hierarchical partition keys, the change feed as an integration backbone, transactional batch, and multi-region writes with conflict resolution — is it safe for balances?`,
  a: r`**Hot partitions**: throughput is divided evenly across physical partitions. 30,000 RU/s over 3 physical partitions gives 10,000 RU/s each; if one logical key receives 40% of writes, that partition throttles (429) while the account looks under-used. Diagnose with **normalized RU consumption by partition key range** and the top logical partition keys in Azure Monitor/diagnostic logs.
- Fixes: a higher-cardinality key; **hierarchical partition keys** (tenant → user → session) so a huge tenant spreads beyond one logical partition's 20 GB and one physical partition's throughput; synthetic keys (key + bucket suffix) for write-heavy counters; burst capacity and **throughput redistribution** across partitions for skew.

**Change feed**: an ordered (per logical partition) record of inserts and updates; latest-version mode by default, all-versions-and-deletes mode for full history. Consume with the **change feed processor** (leases in a container, parallel per range, at-least-once) or Azure Functions Cosmos DB trigger.
Uses: materialised views and search indexes, publishing integration events (the document write is the outbox), cache invalidation, audit streams. Make consumers idempotent; deletes are not in latest-version mode (use soft delete with TTL, or all-versions mode).

**Transactional batch**: ACID operations on items in the **same logical partition** (up to 100 operations, 2 MB) — for example, write a payment and its outbox item together.

**Multi-region writes**: every region accepts writes; replication is asynchronous; conflicts are resolved by **last writer wins** on {{_ts}} (or a custom property), or a **custom stored procedure**, or manual resolution via the conflicts feed.
- **For balances or limits, multi-region writes are unsafe**: two regions can each approve a withdrawal against the same balance and both "win" in different orders. Options: single write region (with automatic failover) for money; or **home-region per account** with routing so each account is written in one region; or operations designed as append-only events with idempotent aggregation.
- Strong consistency is not available with multiple write regions.

**Availability**: single write region with availability zones gives 99.995% read/write with multi-region accounts; multi-region writes up to 99.999%. Choose for the domain, not for the number.`,
  code: r`~~~csharp
// Transactional batch: payment and outbox event atomically in one logical partition (accountId)
var pk = new PartitionKey(payment.AccountId);
TransactionalBatchResponse resp = await container.CreateTransactionalBatch(pk)
    .CreateItem(payment)                                               // id = paymentId; unique per partition
    .CreateItem(new OutboxEvent($"evt-{payment.Id}", payment.AccountId, "PaymentCreated", payment))
    .ExecuteAsync(ct);
if (resp.StatusCode == HttpStatusCode.Conflict) return await LoadExistingAsync(payment.Id, pk, ct); // idempotent retry
if (!resp.IsSuccessStatusCode) throw new CosmosBatchException(resp.StatusCode);

// Change feed processor publishes outbox events to Service Bus (at-least-once; consumers dedupe on event id)
var processor = container.GetChangeFeedProcessorBuilder<OutboxEvent>("outbox-publisher", async (changes, token) =>
    {
        foreach (var e in changes.Where(c => c.Type == "outbox"))
            await sender.SendMessageAsync(new ServiceBusMessage(BinaryData.FromObjectAsJson(e)) { MessageId = e.Id }, token);
    })
    .WithInstanceName(Environment.MachineName)
    .WithLeaseContainer(leases)
    .Build();
await processor.StartAsync();
~~~`,
  dia: r`flowchart LR
  API[Payments API] -->|transactional batch: payment + outbox| C[(Cosmos container - pk accountId)]
  C -->|change feed processor, leases| PUB[Publisher]
  PUB --> SB[(Service Bus - MessageId = event id)]
  C -->|change feed| VIEW[Materialised view / search index]
  C <-->|async replication| C2[(Read region - single write region for balances)]`,
  pts: [r`Throughput splits per physical partition; skewed keys throttle while the account looks idle.`, r`Hierarchical partition keys and synthetic keys relieve hot or large tenants.`, r`The change feed is an at-least-once integration backbone; use transactional batch as the outbox.`, r`Multi-region writes are last-writer-wins by default: unsafe for balances.`, r`Single write region or home-region-per-account for money.`],
  ex: r`A neobank enabled multi-region writes for its card-limits container and saw two regions approve spends that together exceeded a limit; it moved limits to a single write region with zone redundancy.`,
  fu: [r`How would you rebuild a materialised view from scratch using the change feed?`, r`How do you detect a hot logical partition before it throttles?`],
  pit: [r`Multi-region writes for invariant-protected data.`, r`Assuming deletes appear in latest-version change feed.`, r`Treating account-level RU as uniformly available.`] },

{ id: 'q28', level: 'Senior', tags: ['azure-sql', 'failover-groups', 'geo-replication', 'dr'],
  q: r`Design high availability and disaster recovery for an Azure SQL ledger: zone redundancy, active geo-replication versus failover groups, RPO/RTO, failover policy, and what the application must do.`,
  a: r`**Within a region**: Business Critical (or Hyperscale) with **zone redundancy** places replicas in different zones; failover is automatic and typically takes seconds — the app sees transient errors (q11).

**Across regions**
- **Active geo-replication**: up to 4 readable secondaries per database in any region, asynchronous; you fail over per database. Connection strings change (or you manage DNS).
- **Failover groups**: group databases (and Managed Instance) for **coordinated failover**, with **listener endpoints** that never change: {{<fog>.database.windows.net}} (read-write, always the primary) and {{<fog>.secondary.database.windows.net}} (read-only).
- Replication is **asynchronous**: Microsoft documents a geo-replication RPO target of about **5 seconds** for typical workloads — but RPO is whatever the lag is at the moment of failure. Monitor replication lag ({{sys.dm_geo_replication_link_status}}).

**Failover policy**
- **Customer-managed (recommended)**: you decide when to fail over, based on your own health signals and runbook. Planned failover (no data loss, synchronises first) for drills; **forced failover** (possible data loss) for a real regional outage.
- Microsoft-managed: only after an extended outage with a grace period of at least one hour — often too slow for a payments RTO and outside your control.

**What the application must do**
- Use the failover-group **listener** names; retry transient errors during the switch (seconds to a minute); clear connection pools if needed.
- **Fence**: after a forced failover, the old primary must not accept writes if it comes back — failover groups handle this, but app-side caches and queued work must also be considered.
- **Reconcile the RPO gap**: transactions committed in the old primary but not replicated are lost from the database — compare against external truth (PSP settlement files, outbox events already published) and repost. Plan this in the runbook.
- Run compute in the secondary region too (warm standby), with the same secrets, identities and private endpoints pre-provisioned.

**Backups**: automated full/differential/log backups with point-in-time restore (up to 35 days), long-term retention (up to 10 years) for regulatory needs, geo-redundant backup storage for geo-restore as a last resort.`,
  code: r`~~~bash
# Create a failover group with customer-managed failover policy
az sql failover-group create -g rg-payments-prod-weu -s sql-payments-weu -n fog-ledger \
  --partner-server sql-payments-neu --partner-resource-group rg-payments-prod-neu \
  --add-db ledger --failover-policy Manual

# Drill: planned failover (no data loss)       Real outage: forced (possible data loss)
az sql failover-group set-primary -g rg-payments-prod-neu -s sql-payments-neu -n fog-ledger
az sql failover-group set-primary -g rg-payments-prod-neu -s sql-payments-neu -n fog-ledger --allow-data-loss
~~~
~~~sql
-- Watch replication lag on the primary: this is your live RPO
SELECT partner_server, partner_database, replication_state_desc, replication_lag_sec, last_replication
FROM sys.dm_geo_replication_link_status;
~~~`,
  dia: r`flowchart LR
  APP1[App - West Europe] -->|fog-ledger.database.windows.net| L[Read-write listener]
  APP2[App - North Europe warm] -->|same listener| L
  L --> P[(Primary: Business Critical, zone-redundant - WEU)]
  P -->|async geo-replication, lag ~seconds| S[(Secondary - NEU)]
  RO[Reporting] -->|fog-ledger.secondary...| S
  REC[Post-failover reconciliation vs PSP files + outbox] -.repost gap.-> S`,
  pts: [r`Zone-redundant Business Critical/Hyperscale for in-region HA.`, r`Failover groups give stable listeners and coordinated failover.`, r`Geo-replication is async: RPO = lag at failure; monitor it.`, r`Customer-managed failover policy; planned failover for drills, forced for disasters.`, r`Apps use listeners, retry, fence, and reconcile the RPO gap.`],
  ex: r`During a DR drill a bank discovered its batch jobs had hard-coded the primary server name; switching every connection to the failover-group listener made the next drill a 40-second blip.`,
  fu: [r`How would you reconcile transactions lost in a forced failover?`, r`Why not rely on Microsoft-managed failover?`],
  pit: [r`Server names instead of listener endpoints in connection strings.`, r`Assuming zero RPO across regions.`, r`Never running a planned failover drill.`] },

{ id: 'q29', level: 'Senior', tags: ['service-bus', 'reliability', 'geo-disaster-recovery', 'idempotency'],
  q: r`Make Service Bus messaging reliable end to end for payment commands: transactional publishing, idempotent processing, ordered processing per account, Premium sizing, and geo-disaster recovery versus geo-replication.`,
  a: r`**Publishing reliably**: the business transaction and the message must not diverge. Use the **transactional outbox** — write the state change and an outbox row in the same SQL transaction; a relay sends to Service Bus with {{MessageId}} = outbox id and marks it sent. Enable **duplicate detection** so relay retries do not create duplicates.

**Processing exactly once (effectively)**: at-least-once delivery + idempotent consumer.
- Inbox table: insert {{MessageId}} in the same transaction as the side effect; a duplicate violates the primary key and is completed without work.
- Or natural idempotency (upsert by business key, conditional update by version).
- External side effects (PSP calls) carry idempotency keys derived from the business id.

**Ordering per account**: set {{SessionId = accountId}} and use a **session processor**; each session is processed by one consumer at a time in order. Throughput scales with the number of active sessions. A poison message blocks its session — dead-letter it after classification so the session continues, and alert, because skipping a payment step may itself break invariants (park the whole session if order is strict).

**Throughput and sizing**: Premium uses **messaging units** (1, 2, 4, 8, 16); size by load testing — order of magnitude thousands of messages per second per MU depending on size and features. Use batching on send, prefetch on receive, multiple senders/receivers; partition hot entities across namespaces if needed.

**Regional resilience**
- **Geo-disaster recovery** (alias): replicates **metadata only** (entities, subscriptions, rules) to a paired namespace; failover switches the alias. **Messages in the old namespace are not replicated** — they are stranded until it recovers.
- **Geo-replication** (Premium, newer): replicates **metadata and messages** to a secondary region, with configurable synchronous or asynchronous replication and promotion. Check current availability and limits for your regions.
- Either way: the **outbox in a replicated database** lets the new region re-publish unacknowledged commands; consumers' idempotency absorbs duplicates.

**Operations**: alerts on DLQ count, active message age, server errors and throttling; redrive tooling with audit; schema versioning in message properties.`,
  code: r`~~~csharp
// Inbox-based idempotent session consumer: per-account order, effectively-once side effects
var processor = client.CreateSessionProcessor("payment-commands", new ServiceBusSessionProcessorOptions
{
    AutoCompleteMessages = false, MaxConcurrentSessions = 64, MaxConcurrentCallsPerSession = 1
});

processor.ProcessMessageAsync += async args =>
{
    await using var tx = await db.Database.BeginTransactionAsync();
    var inserted = await db.Database.ExecuteSqlInterpolatedAsync(
        $"INSERT INTO inbox (message_id, received_at) SELECT {args.Message.MessageId}, SYSUTCDATETIME() WHERE NOT EXISTS (SELECT 1 FROM inbox WHERE message_id = {args.Message.MessageId})");
    if (inserted == 1)
        await ApplyCommandAsync(args.Message, db);          // state change in the same transaction
    await tx.CommitAsync();
    await args.CompleteMessageAsync(args.Message);          // duplicate: completed with no work
};
~~~`,
  dia: r`flowchart LR
  API[Payments API] -->|one SQL transaction| DB[(Azure SQL: state + outbox)]
  DB --> REL[Outbox relay] -->|MessageId = outbox id, dup detection| SB[(Service Bus Premium: sessions by accountId)]
  SB --> W[Session processor]
  W -->|one transaction: inbox + state| DB2[(Ledger DB)]
  SB -.geo-replication: metadata + messages.-> SB2[(Secondary region namespace)]`,
  pts: [r`Outbox plus duplicate detection for reliable publishing.`, r`Inbox or natural idempotency for effectively-once processing.`, r`Sessions keyed by account give per-account order; handle poison messages deliberately.`, r`Size Premium messaging units by load testing.`, r`Geo-DR alias replicates metadata only; geo-replication also copies messages.`],
  ex: r`After a regional incident a payments team learned their Geo-DR alias had stranded 18,000 commands; outbox replay from the failed-over database re-published them and inbox tables absorbed 2,300 duplicates.`,
  fu: [r`How do you handle a poison message inside a strictly ordered session?`, r`What does the inbox table's retention need to be?`],
  pit: [r`Believing Geo-DR replicates messages.`, r`Publishing directly after commit without an outbox.`, r`Assuming duplicate detection makes consumers idempotent.`] },

{ id: 'q30', level: 'Senior', tags: ['event-hubs', 'partitions', 'checkpointing', 'kafka'],
  q: r`Design Event Hubs for a card-transaction stream: partitions and keys, throughput or processing units, consumer groups, checkpointing with EventProcessorClient, the Kafka endpoint, Capture, and failure handling.`,
  a: r`**Capacity**
- **Standard**: throughput units (TU) — each **1 MB/s or 1,000 events/s ingress, 2 MB/s egress**; auto-inflate can raise TUs. Up to 32 partitions per event hub; retention up to 7 days.
- **Premium**: processing units (PU) with isolation, more partitions, up to 90 days retention; **Dedicated** for very large scale.
- Sizing 50,000 events/s at 1 KB: 50 MB/s ⇒ at least 50 TU equivalents, beyond a single Standard namespace's limit of 40 TUs ⇒ Premium/Dedicated or multiple event hubs/namespaces.

**Partitions**: the unit of ordering and consumer parallelism. Use a **partition key** (card or account id) for per-key order; do not target partitions explicitly unless needed. Partition count is hard or impossible to reduce (and changes break key-to-partition mapping), so plan for peak consumer parallelism (for example 32).

**Consumers**: each **consumer group** is an independent view of the stream (fraud, analytics, archive) with its own offsets. **EventProcessorClient** balances partition ownership across instances via blob-storage leases and **checkpoints** offsets in blob storage.
- Checkpoint **after** processing, in batches (every N events or seconds) — checkpointing every event is slow and costly; a crash replays events since the last checkpoint, so processing must be idempotent.
- A failing event: Event Hubs has **no DLQ**. Catch per event, retry a bounded number of times, then write to a parking store (blob/Service Bus) and continue — otherwise either the partition stalls or the failure is silently skipped.

**Kafka endpoint**: Kafka clients (producers, consumers, Kafka Connect, MirrorMaker) work against Event Hubs without running brokers — useful for migrations and polyglot teams; not every Kafka feature is supported (check compaction/transactions support for your tier).

**Capture**: automatically writes events to ADLS Gen2/Blob in Avro or Parquet on time/size windows — a cheap raw archive and data-lake feed.

**Schema Registry** (in Event Hubs) for Avro/JSON schemas and compatibility rules.

**AWS mapping**: Event Hubs ≈ Kinesis Data Streams / MSK; TU ≈ shard capacity; Capture ≈ Firehose to S3.`,
  code: r`~~~csharp
var checkpoints = new BlobContainerClient(new Uri("https://stcheckpoints.blob.core.windows.net/fraud"), credential);
var processor = new EventProcessorClient(checkpoints, "fraud-features",
    "eh-payments-prod.servicebus.windows.net", "card-telemetry", credential);

var sinceCheckpoint = new ConcurrentDictionary<string, int>();
processor.ProcessEventAsync += async args =>
{
    if (!args.HasEvent) return;
    try { await features.ApplyAsync(args.Data.EventBody.ToObjectFromJson<CardTxn>(), args.CancellationToken); } // idempotent
    catch (Exception ex) when (ex is not OperationCanceledException)
    {
        await parking.SaveAsync(args.Partition.PartitionId, args.Data, ex);   // no DLQ in Event Hubs: park and continue
    }
    if (sinceCheckpoint.AddOrUpdate(args.Partition.PartitionId, 1, (_, n) => n + 1) >= 100)
    {
        await args.UpdateCheckpointAsync();                                    // batch checkpoints
        sinceCheckpoint[args.Partition.PartitionId] = 0;
    }
};
processor.ProcessErrorAsync += e => { log.LogError(e.Exception, "EH error {Op}", e.Operation); return Task.CompletedTask; };
await processor.StartProcessingAsync();
~~~`,
  dia: r`flowchart LR
  SW[Card switch - key accountId] --> EH[(Event Hub: card-telemetry, 32 partitions)]
  EH -->|consumer group fraud| F[EventProcessorClient x4 - leases + checkpoints in Blob]
  EH -->|consumer group analytics| A[Stream Analytics / Fabric]
  EH -->|Capture| DL[(ADLS Gen2 - Parquet)]
  F -->|failed events| PK[(Parking store)]`,
  pts: [r`TU = 1 MB/s or 1,000 events/s in; size on both and plan Premium/Dedicated at high volume.`, r`Partitions define order and parallelism; key by account; plan count up front.`, r`Consumer groups are independent readers; EventProcessorClient checkpoints in Blob.`, r`Checkpoint after processing in batches; replays require idempotency.`, r`No DLQ: park failed events explicitly; Capture for raw archive; Kafka endpoint for Kafka clients.`],
  ex: r`A fraud pipeline that checkpointed every event spent 40% of its time writing to blob storage; checkpointing every 100 events cut consumer cost in half without changing outcomes.`,
  fu: [r`What happens to key ordering if you increase the partition count?`, r`How do you replay a day of events into a new consumer?`],
  pit: [r`Expecting Event Hubs to dead-letter failures.`, r`Checkpointing before processing.`, r`Too few partitions for future consumer parallelism.`] },

{ id: 'q31', level: 'Senior', tags: ['redis', 'azure-managed-redis', 'caching', 'retirement'],
  q: r`Caching on Azure today: Azure Cache for Redis versus Azure Managed Redis, clustering policies, high availability, the retirement timeline, and safe patterns for a .NET payments API.`,
  a: r`**Offerings**
- **Azure Cache for Redis** (Basic, Standard, Premium, Enterprise tiers): the long-standing service. Microsoft has announced its **retirement** — Enterprise tiers first (2027), Basic/Standard/Premium later (2028) — and recommends migrating to Azure Managed Redis. New designs should not start on it.
- **Azure Managed Redis** (GA 2025): based on Redis Enterprise software, multiple SKUs (Memory Optimized, Balanced, Compute Optimized, Flash Optimized), better price-performance, **active geo-replication**, Redis modules (JSON, search, time series, Bloom), and zone redundancy.

**Clustering**: Azure Managed Redis uses clustering; choose the **cluster policy** — OSS cluster (clients connect to shards directly, highest throughput, client must be cluster-aware) or Enterprise (single endpoint with a proxy, simplest for clients). StackExchange.Redis supports both. Multi-key operations need keys in the same hash slot (hash tags such as {{merchant:{42}:config}}) under OSS policy.

**High availability**: replicas across zones; failover takes seconds — clients see connection errors and must reconnect. **Active geo-replication** (multi-region, conflict-free replicated data types) suits session or reference-data caches across regions — it is not a substitute for a system of record.

**Safe patterns for a payments API**
- Cache **derived, rebuildable data** (FX reference rates, merchant configuration, product catalogue, session tokens); never the only copy of balances or idempotency state.
- Cache-aside with TTL + jitter; delete on write; request coalescing for hot keys.
- Fail soft: short timeouts and fallback to the database; a circuit breaker so a slow cache does not consume threads.
- Rate limiting and distributed locks: use carefully — Redis locks (Redlock) are not safe for correctness-critical mutual exclusion under failover; use database constraints or leases with fencing tokens for money.
- Entra ID authentication with managed identity instead of access keys; TLS; private endpoint.

**Migration**: provision Azure Managed Redis, switch clients behind configuration (or dual-write for warm-up), let the old cache expire; data is rebuildable by design, so cold start is acceptable if the database can absorb the miss storm (stagger the cut-over).

**AWS mapping**: ≈ ElastiCache (Valkey/Redis OSS) and MemoryDB; active geo-replication ≈ ElastiCache Global Datastore (which is active-passive).`,
  code: r`~~~csharp
// StackExchange.Redis with Entra ID auth (Microsoft.Azure.StackExchangeRedis) and fail-soft timeouts
var options = await ConfigurationOptions.Parse("amr-payments-prod.westeurope.redis.azure.net:10000")
    .ConfigureForAzureWithTokenCredentialAsync(new ManagedIdentityCredential(clientId));
options.AbortOnConnectFail = false;
options.SyncTimeout = options.AsyncTimeout = 250;
var mux = await ConnectionMultiplexer.ConnectAsync(options);       // singleton

public async Task<MerchantConfig> GetMerchantAsync(string merchantId, CancellationToken ct)
{
    var key = $"merchant:{{{merchantId}}}:config";                  // hash tag keeps related keys in one slot
    try
    {
        var hit = await _db.StringGetAsync(key);
        if (hit.HasValue) return JsonSerializer.Deserialize<MerchantConfig>(hit!)!;
    }
    catch (RedisException ex) { _log.LogWarning(ex, "Cache unavailable, falling back"); }

    var cfg = await _repo.GetMerchantAsync(merchantId, ct);
    _ = _db.StringSetAsync(key, JsonSerializer.Serialize(cfg), TimeSpan.FromMinutes(5 + Random.Shared.Next(3)), flags: CommandFlags.FireAndForget);
    return cfg;
}
~~~`,
  dia: r`flowchart LR
  API[Payments API - singleton multiplexer] -->|1 get| AMR[(Azure Managed Redis - zone redundant)]
  API -->|2 miss / cache down| SQL[(Azure SQL - system of record)]
  API -->|3 set with TTL + jitter| AMR
  AMR <-->|active geo-replication| AMR2[(Second region cache)]`,
  pts: [r`Azure Cache for Redis is being retired; start new work on Azure Managed Redis.`, r`Choose OSS or Enterprise cluster policy; hash tags for multi-key operations.`, r`Failover takes seconds; clients must reconnect and fail soft.`, r`Cache rebuildable data only; never balances or idempotency state.`, r`Entra auth, private endpoint; plan migration with staggered cut-over.`],
  ex: r`A broker's quote service migrated from Azure Cache for Redis Premium to Azure Managed Redis Balanced with a configuration switch per region; p99 latency improved and the cache bill fell by about a third.`,
  fu: [r`Why are Redis-based locks unsafe for payment mutual exclusion?`, r`How do you warm a new cache without overloading the database?`],
  pit: [r`Starting new projects on a retiring service.`, r`Using the cache as the system of record.`, r`Long timeouts that let a slow cache stall the API.`] },

{ id: 'q32', level: 'Senior', tags: ['autoscale', 'keda', 'vmss', 'capacity'],
  q: r`Design autoscaling on Azure for an API and a queue worker: App Service autoscale versus automatic scaling, VMSS, KEDA on Container Apps/AKS, Service Bus backlog targets, and why scaling can lag.`,
  a: r`**Mechanisms**
- **App Service**: rule-based **autoscale** (Azure Monitor autoscale on CPU, memory, HTTP queue length, or custom metrics, with schedules and profiles) or **automatic scaling** (platform scales on HTTP load with prewarmed instances, Premium plans). Scale-out adds instances to the whole plan — all apps on it.
- **VM Scale Sets**: autoscale rules or predictive autoscale (CPU-based forecasting), standby pools for faster scale-out.
- **Container Apps / AKS**: **KEDA** scalers (Service Bus, Event Hubs, Kafka, HTTP concurrency, cron); AKS adds cluster autoscaler or node autoprovisioning for nodes.
- **Functions**: scale controller on trigger backlog, capped by maximum instance count.

**API scaling**: CPU is a weak signal for I/O-bound ASP.NET Core. Prefer requests per instance, HTTP queue length or latency-derived metrics; scale out quickly, scale in slowly (cooldowns, flapping protection — Azure autoscale evaluates scale-in against the post-scale state to avoid flapping).

**Queue worker sizing**: target messages per replica = acceptable delay ÷ processing time per message. 0.4 s per message and 60 s acceptable delay ⇒ about 150 messages per replica. KEDA's Service Bus scaler {{messageCount: 150}} computes desired replicas = backlog ÷ 150. Cap **maxReplicas** by downstream capacity (SQL worker limits, PSP rate limits), not by backlog.

**Why scaling lags**
1. Metric aggregation windows and evaluation intervals (minutes for Azure Monitor autoscale).
2. Provisioning: new App Service instances or nodes take tens of seconds to minutes; container image pulls; .NET start-up and warm-up.
3. Cold caches and connection pools on new instances.
A 4x spike in 30 seconds cannot be absorbed reactively.

**Mitigations**: headroom (scale at 50-60% utilisation), **scheduled profiles** before known peaks (market open, payroll), minimum instance counts, prewarmed instances (App Service automatic scaling, Functions Premium/always-ready), smaller images and ReadyToRun, queue-based load levelling, rate limiting to shed excess gracefully.`,
  code: r`~~~bicep
// App Service: scheduled minimum for market open + CPU rule with conservative scale-in
resource autoscale 'Microsoft.Insights/autoscalesettings@2022-10-01' = {
  name: 'as-payments-api'
  location: location
  properties: {
    targetResourceUri: plan.id
    enabled: true
    profiles: [
      {
        name: 'market-hours'
        capacity: { minimum: '8', maximum: '20', default: '8' }
        recurrence: { frequency: 'Week', schedule: { timeZone: 'GMT Standard Time', days: [ 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday' ], hours: [ 7 ], minutes: [ 30 ] } }
        rules: [
          { metricTrigger: { metricName: 'CpuPercentage', metricResourceUri: plan.id, timeGrain: 'PT1M', statistic: 'Average', timeWindow: 'PT5M', timeAggregation: 'Average', operator: 'GreaterThan', threshold: 60 }
            scaleAction: { direction: 'Increase', type: 'ChangeCount', value: '3', cooldown: 'PT3M' } }
          { metricTrigger: { metricName: 'CpuPercentage', metricResourceUri: plan.id, timeGrain: 'PT1M', statistic: 'Average', timeWindow: 'PT15M', timeAggregation: 'Average', operator: 'LessThan', threshold: 30 }
            scaleAction: { direction: 'Decrease', type: 'ChangeCount', value: '1', cooldown: 'PT10M' } }
        ]
      }
    ]
  }
}
// Worker: KEDA azure-servicebus scaler messageCount 150, maxReplicas 25 (bounded by SQL worker limit)
~~~`,
  dia: r`flowchart LR
  SCH[Scheduled profile 07:30 min 8] --> PLAN[App Service plan]
  CPU[CPU over 60 percent for 5 min] -->|+3 instances| PLAN
  SB[(Service Bus backlog)] -->|KEDA: backlog / 150| WK[Worker replicas 1..25]
  WK --> SQL[(Azure SQL - worker limit caps max replicas)]`,
  pts: [r`App Service autoscale or automatic scaling; VMSS; KEDA on Container Apps/AKS; Functions scale controller.`, r`Scale APIs on load signals, scale out fast, scale in slowly.`, r`Workers: messages per replica = acceptable delay / time per message; cap by downstream.`, r`Reactive scaling lags minutes: metrics, provisioning, warm-up.`, r`Scheduled profiles, headroom, prewarmed instances and load levelling.`],
  ex: r`A brokerage API failed every market open until a 07:30 scheduled profile raised the minimum to 8 instances; the 08:00 error spike vanished and daily cost rose only 6%.`,
  fu: [r`Why does scaling out an App Service plan affect every app on it?`, r`How do you scale on latency without oscillation?`],
  pit: [r`Scaling queue workers on CPU.`, r`Unbounded max replicas against a database.`, r`Aggressive scale-in that flaps.`] },

{ id: 'q33', level: 'Senior', tags: ['incident', 'snat', 'app-service', 'httpclient'],
  q: r`Incident: an App Service API calling a PSP and Azure SQL shows intermittent connection timeouts and 5xx under load, CPU at 40%. Diagnostics hint at SNAT port exhaustion. Explain SNAT, how you confirm it, the fixes and prevention.`,
  a: r`**What SNAT is**: outbound connections from App Service (and VMs without public IPs) to public endpoints are translated to a shared public IP. Each instance gets a limited **pre-allocated SNAT port budget** (on the order of 128 ports per instance for App Service, with more allocated on demand but not guaranteed). Each connection to the same destination IP:port consumes a port; ports are held for a while after close. Opening many short-lived connections — or holding many idle ones — exhausts them, and new outbound connections **hang until timeout**.

**Classic .NET causes**
- {{new HttpClient()}} per request (sockets not reused; ports in TIME_WAIT).
- No connection pooling or very large pools to many destinations.
- Calling Azure services (SQL, Storage, Key Vault) over their **public** endpoints, which also consumes SNAT.
- Long timeouts to a slow PSP: connections pile up.

**Confirm**
- App Service **Diagnose and solve problems → SNAT Port Exhaustion** detector; Application Insights dependency failures with long durations and connection timeouts, not server errors.
- Correlation: errors rise with outbound concurrency while CPU is moderate; affects all outbound destinations from the instance.
- TCP connection counts per instance (diagnostics tools / metrics).

**Fixes (in order of leverage)**
1. **Reuse connections**: {{IHttpClientFactory}} or a singleton {{SocketsHttpHandler}} with {{PooledConnectionLifetime}} (for DNS changes); singleton SDK clients (SqlClient pooling, Storage, Service Bus).
2. **Private endpoints / VNet integration** for Azure SQL, Storage, Key Vault — private traffic does not use SNAT.
3. **NAT Gateway** on the integration subnet with route-all: 64,512 ports per public IP, up to 16 IPs, and a stable egress IP for PSP allow lists.
4. Sensible timeouts and circuit breakers to the PSP so slow responses do not accumulate connections; limit concurrency per destination ({{MaxConnectionsPerServer}}).
5. Scale out as a temporary mitigation (more instances = more ports), not the fix.

**Prevention**: code-review and analyzer rules against {{new HttpClient}} in request paths, load tests with realistic outbound fan-out, alerts on SNAT/connection metrics and dependency timeout rate, private endpoints as the landing-zone default.`,
  code: r`~~~csharp
// Typed client with pooled, long-lived connections and bounded concurrency to the PSP
builder.Services.AddHttpClient<IPspClient, PspClient>(c =>
{
    c.BaseAddress = new Uri("https://api.psp.example/");
    c.Timeout = TimeSpan.FromSeconds(5);
})
.ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
{
    PooledConnectionLifetime = TimeSpan.FromMinutes(5),     // pick up DNS changes, still reuse sockets
    MaxConnectionsPerServer = 100,                          // bounded: protects SNAT and the PSP
    EnableMultipleHttp2Connections = true
})
.AddStandardResilienceHandler();                            // retries with jitter, circuit breaker, timeouts

// The bug that caused the incident:
// using var http = new HttpClient();   // per request -> new socket -> new SNAT port -> exhaustion under load
~~~`,
  dia: r`flowchart LR
  subgraph Before
    A1[App instance] -->|new HttpClient per request| SNAT1[Shared SNAT: ~128 ports]
    SNAT1 --> PSP1[PSP]
    SNAT1 --> SQL1[(Azure SQL public endpoint)]
  end
  subgraph After
    A2[App instance - pooled clients] -->|VNet integration| NAT[NAT Gateway: 64k ports per IP]
    NAT --> PSP2[PSP - allow-listed IP]
    A2 -->|private endpoint, no SNAT| SQL2[(Azure SQL)]
  end`,
  pts: [r`SNAT ports per instance are limited; each outbound connection to a destination consumes one.`, r`New HttpClient per request and public endpoints to Azure services are the usual causes.`, r`Confirm with the App Service SNAT detector and dependency timeout patterns.`, r`Fix with connection reuse, private endpoints, NAT Gateway and bounded concurrency.`, r`Scaling out only buys time.`],
  ex: r`A card-acceptance API on App Service timed out at Black Friday peak; IHttpClientFactory, private endpoints for SQL and Key Vault, and a NAT Gateway removed SNAT exhaustion and gave the PSP a fixed IP to allow-list.`,
  fu: [r`Why does PooledConnectionLifetime matter for Azure-hosted dependencies?`, r`How would the same problem appear on AKS?`],
  pit: [r`Treating timeouts as a PSP problem without checking SNAT.`, r`Scaling up instead of fixing connection reuse.`, r`Calling Azure PaaS over public endpoints from App Service.`] },

{ id: 'q34', level: 'Senior', tags: ['zone-resilience', 'chaos-studio', 'static-stability'],
  q: r`Design a payments service on Azure to survive a zone failure and partial degradation: zone-redundant service choices, capacity planning, health modelling, and testing with Azure Chaos Studio.`,
  a: r`**Choose zone-redundant building blocks** (and check they are configured at creation)
| Layer | Zone-resilient choice |
|---|---|
| Entry | Front Door (global), Application Gateway v2 zone-redundant, Standard Load Balancer |
| Compute | App Service plan with zone redundancy (≥3 instances), Container Apps environment zone-redundant, AKS node pools across zones |
| Data | Azure SQL Business Critical/Hyperscale zone-redundant, Cosmos DB with availability zones, ZRS/GZRS storage |
| Messaging | Service Bus Premium and Event Hubs (zone redundancy by default in supporting regions) |
| Cache | Azure Managed Redis zone-redundant |
| Secrets | Key Vault (zone-resilient within region) |

**Static stability**: provision for **N-1 zones**: peak needing 12 instances across 3 zones ⇒ 18 (6 per zone), so losing a zone needs no scale-out during the event, when the control plane may be busy or impaired.

**Partial degradation (gray failure)**: a zone with high latency rather than an outage. Shallow health probes pass; deep probes that check shared dependencies can fail every instance at once. Model health per zone: compare latency/error rates per zone (instance metadata includes the zone), alert on outliers, and remove degraded instances (App Service health check, AKS readiness, Load Balancer probes).

**Dependencies**: make sure every hop is zone-resilient — a zone-redundant app calling a zonal VM-based component is only as good as that VM. Identify **single points**: self-hosted gateways, NVAs, jump boxes, a single-zone Redis.

**Testing with Azure Chaos Studio**
- **Service-direct faults**: Cosmos DB failover, AKS Chaos Mesh faults (pod kill, network delay), VMSS shutdown by zone, NSG rule faults to cut connectivity, Key Vault access denial.
- **Agent-based faults** on VMs: CPU/memory pressure, network latency, process kill.
- Build experiments around a hypothesis ("losing zone 2 keeps p99 < 300 ms and no failed payments"), with SLO-based guardrails and a stop button; run in pre-production regularly, then in production in controlled windows.

**Health model and runbook**: a documented dependency map, per-zone dashboards, a decision tree for "degraded zone": remove instances in that zone (or rely on platform), communicate, verify recovery.`,
  code: r`~~~json
// Chaos Studio experiment (excerpt): shut down AKS-backing VMSS instances in zone 2 for 10 minutes
{
  "properties": {
    "selectors": [ { "type": "List", "id": "zone2-vmss",
      "targets": [ { "type": "ChaosTarget", "id": "/subscriptions/<sub>/resourceGroups/MC_rg-aks/providers/Microsoft.Compute/virtualMachineScaleSets/aks-user-zone2/providers/Microsoft.Chaos/targets/Microsoft-VirtualMachineScaleSet" } ] } ],
    "steps": [ { "name": "zone-loss", "branches": [ { "name": "shutdown", "actions": [ {
      "type": "continuous", "name": "urn:csci:microsoft:virtualMachineScaleSet:shutdown/2.0",
      "duration": "PT10M", "selectorId": "zone2-vmss",
      "parameters": [ { "key": "abruptShutdown", "value": "true" } ] } ] } ] } ]
  }
}
~~~`,
  dia: r`flowchart TB
  FD[Front Door] --> AGW[App Gateway v2 - zone-redundant]
  subgraph Z1[Zone 1]
    A1[6 instances]
  end
  subgraph Z2[Zone 2 - fault injected]
    A2[6 instances]
  end
  subgraph Z3[Zone 3]
    A3[6 instances]
  end
  AGW --> A1
  AGW -.probes fail, removed.-> A2
  AGW --> A3
  A1 --> SQL[(Azure SQL BC - zone-redundant)]
  A3 --> SQL
  CS[Chaos Studio experiment + SLO guardrail] -.-> Z2`,
  pts: [r`Select zone-redundant SKUs for every layer, set at creation.`, r`Provision N-1 zone capacity for static stability.`, r`Detect gray failures with per-zone metrics; avoid deep probes on shared dependencies.`, r`Find zonal single points in the dependency chain.`, r`Test hypotheses with Chaos Studio under SLO guardrails.`],
  ex: r`A Chaos Studio zone-shutdown experiment revealed that a payments platform's self-hosted APIM gateway ran on a single zonal VM; moving it to a zone-spread scale set closed the gap before a real incident.`,
  fu: [r`How do you know which zone an App Service instance is in?`, r`What would you never run as a chaos experiment in production?`],
  pit: [r`Assuming services are zone-redundant without checking SKU and setting.`, r`Capacity for 100% of peak across three zones.`, r`Deep health probes that fail all instances together.`] },

{ id: 'q35', level: 'Senior', tags: ['entra-id', 'oauth', 'microsoft-identity-web', 'app-roles'],
  q: r`Secure a .NET API and an Angular/React SPA with Entra ID: app registrations versus enterprise applications, scopes versus app roles, Microsoft.Identity.Web, service-to-service calls, and customer identity with Entra External ID.`,
  a: r`**Objects**
- **App registration**: the global definition of an application (redirect URIs, exposed API scopes, app roles, credentials). Lives in its home tenant.
- **Enterprise application (service principal)**: the instance of that app in a tenant — where you assign users/groups, consent and Conditional Access apply. Multi-tenant apps have one registration and a service principal per customer tenant.

**Delegated vs application permissions**
- **Scopes** ({{api://payments/Payments.Read}}): delegated — the app acts **on behalf of a signed-in user**; access = user's rights ∩ scope.
- **App roles**: assigned to users/groups (role-based authorisation in the token's {{roles}} claim) or to **applications** for daemon/service-to-service access (client credentials flow).

**SPA (Angular/React)**: **authorization code flow with PKCE** via MSAL.js ({{@azure/msal-angular}}, {{@azure/msal-react}}); tokens in memory/session storage per MSAL defaults; short-lived access tokens; acquire tokens silently per API scope. Consider a **BFF** (backend-for-frontend) holding tokens server-side when the threat model demands no tokens in the browser.

**API (.NET)**: **Microsoft.Identity.Web** validates issuer, audience, signature (keys from the tenant's metadata, rotated automatically), lifetime; enforce scopes ({{RequiredScope}}) and roles ({{[Authorize(Roles=...)]}}); object-level authorisation in code (can this user see account 42?).

**Service-to-service**
- Inside Azure: **managed identity** acquires a token for the downstream API's app ID URI; downstream checks an **app role** assigned to that identity.
- **On-behalf-of** flow when an API calls another API as the user (preserves user context and audit).

**Conditional Access**: MFA, compliant devices, location rules for users; Conditional Access for workload identities for service principals.

**Customers (B2C)**: **Microsoft Entra External ID** is the current customer-identity platform; Azure AD B2C is no longer available to new customers (existing tenants continue to be supported). Plan new customer-facing apps on External ID.

**AWS mapping**: Entra ID app registration ≈ Cognito app client / external IdP integration; app roles ≈ Cognito groups/claims; managed identity tokens for APIs ≈ IAM-signed calls (SigV4) — a real divergence: Azure uses OAuth tokens everywhere, AWS uses SigV4 for its own APIs.`,
  code: r`~~~csharp
// API: Microsoft.Identity.Web with scope and role checks
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(builder.Configuration.GetSection("AzureAd"));   // Instance, TenantId, ClientId, Audience
builder.Services.AddAuthorization(o =>
{
    o.AddPolicy("PaymentsRead", p => p.RequireScopeOrAppPermission(["Payments.Read"], ["Payments.Read.All"]));
});

app.MapGet("/v1/accounts/{id}", async (string id, ClaimsPrincipal user, IAccountService svc) =>
{
    var account = await svc.GetAsync(id);
    return account is not null && account.OwnerObjectId == user.GetObjectId()   // object-level authorisation
        ? Results.Ok(account) : Results.NotFound();
}).RequireAuthorization("PaymentsRead");
~~~
~~~typescript
// Angular: MSAL interceptor attaches tokens for the API's scope (auth code + PKCE)
MsalModule.forRoot(
  new PublicClientApplication({ auth: { clientId: '<spa-client-id>', authority: 'https://login.microsoftonline.com/<tenant-id>', redirectUri: '/' } }),
  { interactionType: InteractionType.Redirect },
  { interactionType: InteractionType.Redirect,
    protectedResourceMap: new Map([['https://api.bank.example/v1/', ['api://payments/Payments.Read']]]) });
~~~`,
  dia: r`sequenceDiagram
  participant SPA as Angular SPA (MSAL)
  participant E as Entra ID
  participant API as Payments API
  participant D as Ledger API
  SPA->>E: auth code + PKCE
  E-->>SPA: access token, scope Payments.Read
  SPA->>API: GET /v1/accounts/42 Bearer
  API->>API: validate iss, aud, scope, then check ownership
  API->>E: managed identity token for ledger (app role)
  API->>D: call with app token`,
  pts: [r`App registration = definition; enterprise application = tenant instance with assignments and policies.`, r`Scopes for delegated access; app roles for role-based and app-to-app access.`, r`SPA uses auth code + PKCE with MSAL; consider a BFF.`, r`Microsoft.Identity.Web validates tokens; object-level checks stay in code.`, r`Managed identity or OBO for service calls; Entra External ID for new customer identity.`],
  ex: r`A wealth portal's API accepted any token from the tenant because it validated issuer but not audience; adding audience and scope checks via Microsoft.Identity.Web closed a cross-application token reuse finding.`,
  fu: [r`When would you use the on-behalf-of flow instead of the API's own identity?`, r`How do you handle app role changes without forcing users to sign out?`],
  pit: [r`Not validating the audience.`, r`Using client secrets for Azure-hosted services instead of managed identity.`, r`Starting new customer identity projects on Azure AD B2C.`] },

{ id: 'q36', level: 'Senior', tags: ['encryption', 'cmk', 'always-encrypted', 'tde'],
  q: r`Encryption on Azure for regulated data: platform-managed versus customer-managed keys, TDE and Always Encrypted for Azure SQL, confidential computing, and the operational risks of holding your own keys.`,
  a: r`**At rest — layers**
- **Platform-managed keys (PMK)**: on by default for Storage, SQL (TDE), Cosmos DB, disks. Microsoft manages the keys. Meets most "encryption at rest" requirements.
- **Customer-managed keys (CMK)** in Key Vault or Managed HSM: you control rotation, access and **revocation** — disabling the key makes the data unreadable (crypto-shredding). Often required by bank policies or regulators for sensitive data, and for tenant offboarding in SaaS.
- **Infrastructure (double) encryption** for Storage: a second layer with a different algorithm/key.

**Azure SQL**
- **TDE**: encrypts data files and backups at rest; transparent to apps; with CMK ("BYOK TDE") the server's identity wraps the database encryption key with your Key Vault key.
- **Always Encrypted**: column-level encryption **performed in the client driver**; the database engine (and DBAs, and anyone with server access) never sees plaintext. Deterministic encryption allows equality lookups; randomized is stronger but not searchable. **Always Encrypted with secure enclaves** allows richer operations (range, pattern) inside a trusted enclave. Use for PANs (if stored), national IDs, salary data.
- **Dynamic data masking** is not encryption — it only masks query results for non-privileged users.

**In transit**: TLS 1.2+ everywhere (minimum TLS version settings on Storage, SQL, App Service); mTLS for partner APIs (APIM, App Gateway).

**In use — confidential computing**: confidential VMs (AMD SEV-SNP / Intel TDX), confidential containers on AKS/Container Instances, SGX enclaves — data protected in memory from the host/operator, with attestation. Niche but relevant for multi-party data and strict sovereignty requirements.

**Operational risks of CMK (say these aloud)**
- **Key deletion or access loss = outage and potential data loss**: enable soft delete + **purge protection**, restrict who can disable keys, alert on key operations.
- **Key Vault availability** becomes a dependency for every encrypted service; replicate keys appropriately for DR (Key Vault content is replicated to the paired region for disaster recovery; Managed HSM offers multi-region replication).
- **Rotation**: automatic key rotation policies; services re-wrap data keys without re-encrypting data.
- Separation of duties: the security team owns keys; app teams cannot delete them.

**AWS mapping**: PMK/CMK ≈ AWS-owned/AWS-managed vs customer-managed KMS keys; Managed HSM ≈ CloudHSM / KMS custom key store; Always Encrypted has no direct AWS RDS equivalent (application-level or client-side encryption instead).`,
  code: r`~~~csharp
// Always Encrypted: the driver encrypts/decrypts; column master key in Key Vault
SqlConnection.RegisterColumnEncryptionKeyStoreProviders(new Dictionary<string, SqlColumnEncryptionKeyStoreProvider>
{
    [SqlColumnEncryptionAzureKeyVaultProvider.ProviderName] = new SqlColumnEncryptionAzureKeyVaultProvider(credential)
});
var cs = "Server=tcp:fog-ledger.database.windows.net;Database=customers;Authentication=Active Directory Managed Identity;" +
         "Column Encryption Setting=Enabled;Encrypt=True";

await using var conn = new SqlConnection(cs);
await using var cmd = new SqlCommand("SELECT CustomerId FROM dbo.Customers WHERE NationalId = @nid", conn);
cmd.Parameters.Add(new SqlParameter("@nid", SqlDbType.Char, 11) { Value = nationalId });  // parameterised: encrypted client-side
await conn.OpenAsync();
var id = await cmd.ExecuteScalarAsync();
~~~
~~~sql
CREATE TABLE dbo.Customers (
  CustomerId  int IDENTITY PRIMARY KEY,
  NationalId  char(11) COLLATE Latin1_General_BIN2
              ENCRYPTED WITH (COLUMN_ENCRYPTION_KEY = CEK_Customers, ENCRYPTION_TYPE = DETERMINISTIC,
                              ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256') NOT NULL
);
~~~`,
  dia: r`flowchart LR
  APP[.NET app - SqlClient Always Encrypted] -->|unwrap CEK| KV[Key Vault / Managed HSM: column master key]
  APP -->|ciphertext only| SQL[(Azure SQL: TDE with CMK + encrypted columns)]
  SQL -->|wrap DEK| KV2[Key Vault: TDE protector - purge protection]
  DBA[DBA / platform operator] -.sees ciphertext only.-> SQL`,
  pts: [r`PMK by default; CMK adds control, rotation and crypto-shredding.`, r`TDE protects files and backups; Always Encrypted hides plaintext from the database itself.`, r`Dynamic data masking is not encryption.`, r`Confidential computing protects data in use where required.`, r`CMK risks: deletion, availability, rotation; purge protection and separation of duties.`],
  ex: r`A bank's DBA team could previously read national ID numbers; Always Encrypted with keys owned by the security team removed DBAs from the data's trust boundary and satisfied an internal audit finding.`,
  fu: [r`What happens to an Azure SQL database if its TDE protector key becomes inaccessible?`, r`When is deterministic encryption acceptable?`],
  pit: [r`Calling dynamic data masking encryption.`, r`CMK without purge protection.`, r`App teams able to disable encryption keys.`] },

{ id: 'q37', level: 'Principal', tags: ['disaster-recovery', 'multi-region', 'rpo-rto'],
  q: r`Design multi-region disaster recovery on Azure for a payments platform: choosing the secondary region, per-service replication (SQL, Cosmos DB, Storage, Service Bus, Key Vault), traffic failover with Front Door, and proving RTO/RPO.`,
  a: r`**Start from business RTO/RPO per capability** (authorisation: RTO 15 min, RPO near zero; statements: RTO 24 h). Then choose a pattern: backup/restore, pilot light, **warm standby** (most common for payments), or active-active (only where the data model tolerates it).

**Choosing the secondary region**: same geography for data residency (West Europe ↔ North Europe, or Germany West Central ↔ Germany North for German data), service and SKU availability (zone support, Business Critical, Premium messaging), capacity, latency. Region pairs bring sequenced updates and GRS targets, but some newer regions have no pair — your own choice is valid.

**Per-service replication**
| Service | Mechanism | Notes |
|---|---|---|
| Azure SQL | failover group | async, RPO ≈ seconds of lag; customer-managed failover |
| Cosmos DB | multi-region account, single write region + automatic or service-managed failover | multi-region writes only for conflict-tolerant data |
| Storage | GZRS/RA-GZRS, or object replication to a separate account | customer-initiated failover; async (minutes) |
| Service Bus | geo-replication (messages + metadata) or Geo-DR alias (metadata only) | outbox replay closes gaps |
| Event Hubs | geo-replication / Geo-DR, or dual-write and Capture | consumers resume from checkpoints |
| Key Vault | built-in replication for DR, or a vault per region with IaC-synced secrets | Managed HSM multi-region replication |
| Compute | IaC-deployed warm standby (scaled down), same images by digest | pre-create identities, private endpoints, DNS |

**Traffic**: **Front Door** origin groups with priority routing and health probes give automatic HTTP failover; keep the failover decision for the **database primary** human (runbook with pre-approval) to avoid split brain, while stateless tiers follow automatically.

**Ordering of a regional failover**: declare incident → fence primary region writers → fail over SQL failover group (forced if needed) → promote Cosmos/messaging → scale up standby compute → Front Door shifts (or flip priority) → reconcile the RPO gap (outbox replay, PSP settlement comparison) → communicate.

**Prove it**: twice-yearly full failover drills, measured RTO/RPO, chaos experiments, backups in an immutable vault (Azure Backup with immutable vaults and soft delete) against ransomware. Regulators (DORA, PRA operational resilience, OCC) increasingly expect evidence of tested recovery within impact tolerances.`,
  code: r`~~~bash
# Regional failover runbook (excerpt) - each step logged to the incident record
az sql failover-group set-primary -g rg-pay-neu -s sql-pay-neu -n fog-ledger --allow-data-loss     # 1 database
az cosmosdb failover-priority-change -g rg-pay -n cosmos-pay --failover-policies northeurope=0 westeurope=1  # 2 Cosmos write region
az containerapp update -g rg-pay-neu -n ca-payments-api --min-replicas 12                         # 3 scale standby
az afd origin update -g rg-edge --profile-name fd-pay --origin-group-name api --origin-name weu \
  --enabled-state Disabled                                                                          # 4 drain primary origin
dotnet run --project tools/OutboxReplay -- --since "2026-10-11T09:40:00Z"                           # 5 close the RPO gap
~~~`,
  dia: r`flowchart LR
  U[Clients] --> FD[Front Door - priority origin groups]
  FD -->|priority 1| WEU[West Europe: full stack]
  FD -.priority 2.-> NEU[North Europe: warm standby]
  WEU --> SQLP[(SQL primary)] -->|failover group async| SQLS[(SQL secondary)]
  WEU --> CP[(Cosmos write region)] -->|replication| CS[(Cosmos read region)]
  WEU --> SBP[(Service Bus)] -->|geo-replication| SBS[(Service Bus secondary)]
  NEU --> SQLS
  BK[Azure Backup immutable vault] -.-> WEU`,
  pts: [r`RTO/RPO per capability drives the pattern; warm standby is common for payments.`, r`Pick the secondary for residency, SKU availability and capacity; pairs are optional.`, r`Replicate every stateful service deliberately; messaging gaps closed by outbox replay.`, r`Front Door automates stateless failover; database promotion is a human decision.`, r`Drills, measured RTO/RPO and immutable backups provide regulatory evidence.`],
  ex: r`A payments provider's first full drill took 2 hours instead of 30 minutes because private DNS records were missing in the secondary region; after IaC fixes the next drill completed in 24 minutes.`,
  fu: [r`What would make active-active acceptable for this platform?`, r`How do you fail back after the primary region recovers?`],
  pit: [r`Assuming the paired region is automatically the DR plan.`, r`Forgetting identities, DNS and private endpoints in the standby.`, r`Untested runbooks.`] },

{ id: 'q38', level: 'Principal', tags: ['system-design', 'payments', 'reference-architecture'],
  q: r`Design a card-payment acceptance platform on Azure for 2,000 TPS peak, 99.99% availability, PCI DSS, EU residency and zero double charges. Walk through the architecture and key decisions.`,
  a: r`**Framing**: 2,000 TPS is modest for Azure; correctness (no double charge, no lost payment), PCI scope and availability are the drivers. 99.99% allows about 4.3 minutes of downtime per month — zone redundancy everywhere plus warm standby in a second EU region.

**Request path**
1. **Front Door Premium** (WAF, bot protection, TLS 1.2+) → **APIM** (internal mode, per-merchant rate limits, mTLS/OAuth for merchants) → **Container Apps** (or AKS) payments API in a Corp landing zone spoke, zone-redundant, N-1 capacity.
2. API requires {{Idempotency-Key}}; writes the payment ({{PENDING}}) and an outbox row in **Azure SQL Business Critical** (zone-redundant, failover group to North Europe) in one transaction, guarded by a unique constraint on (merchant, key).
3. **Card data**: PSP hosted fields keep PANs out; if tokenisation is in-house, a separate **CDE subscription** with Managed HSM / Azure Payment HSM, its own spoke, strict policies, private endpoints only.
4. **PSP adapter** calls the acquirer with the same idempotency key; timeouts go to {{UNKNOWN}} and are resolved by status query or reconciliation — never retried as a new charge. Per-PSP circuit breakers with failover to a secondary PSP.
5. **Outbox relay → Service Bus Premium** topics (geo-replicated) → ledger, notifications, fraud, reporting subscriptions; idempotent consumers with inbox tables.
6. **Ledger**: double-entry, append-only postings in Azure SQL; materialised balances updated transactionally.
7. **Reconciliation**: PSP settlement files land in Blob (immutability policy) → Durable Functions fan-out compares with the ledger → breaks classified and routed.
8. **Telemetry**: card events to Event Hubs for fraud features; Azure Monitor/App Insights for SLOs; Sentinel for security.

**Key decisions**
- **Azure SQL over Cosmos DB for the core ledger**: relational integrity, transactions across rows, reconciliation queries, mature DR; Cosmos acceptable for idempotency/session data.
- **Container Apps vs AKS**: Container Apps unless the platform team already runs AKS well.
- **Subscriptions as PCI boundaries**; Azure Policy PCI DSS initiative; Defender for Cloud compliance dashboard.
- **EU residency**: allowed-locations policy, EU regions only, check telemetry and support tooling locations.
- **Managed identities everywhere**, private endpoints, no public PaaS endpoints.`,
  code: r`~~~sql
CREATE TABLE payments.Payment (
  PaymentId       uniqueidentifier NOT NULL PRIMARY KEY NONCLUSTERED,
  MerchantId      varchar(32)  NOT NULL,
  IdempotencyKey  varchar(64)  NOT NULL,
  RequestHash     binary(32)   NOT NULL,
  AmountMinor     bigint       NOT NULL CHECK (AmountMinor > 0),
  Currency        char(3)      NOT NULL,
  CardToken       varchar(64)  NOT NULL,               -- token, never a PAN
  Status          varchar(16)  NOT NULL CHECK (Status IN ('PENDING','AUTHORISED','DECLINED','UNKNOWN','CAPTURED','REFUNDED')),
  PspReference    varchar(64)  NULL,
  CreatedAt       datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_Payment_Idem UNIQUE (MerchantId, IdempotencyKey)   -- the double-charge guard
);
CREATE CLUSTERED INDEX CIX_Payment_Created ON payments.Payment (CreatedAt, PaymentId);
CREATE TABLE payments.Outbox (
  OutboxId bigint IDENTITY PRIMARY KEY, AggregateId uniqueidentifier NOT NULL, EventType varchar(64) NOT NULL,
  Payload nvarchar(max) NOT NULL, CreatedAt datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(), PublishedAt datetime2(3) NULL
);
~~~`,
  dia: r`flowchart LR
  M[Merchant checkout] --> FD[Front Door Premium + WAF]
  M -->|hosted fields| TOK[Tokenisation - CDE subscription, HSM]
  FD --> APIM[APIM internal - mTLS, rate limits]
  APIM --> API[Payments API - Container Apps, 3 zones]
  API --> SQL[(Azure SQL BC: payment + outbox, failover group)]
  API --> PSPA[PSP adapter] --> PSP[PSP / acquirer]
  SQL --> REL[Outbox relay] --> SB{{Service Bus Premium topics}}
  SB --> LED[Ledger]
  SB --> NOT[Notifications]
  SB --> FR[Fraud]
  FILES[Settlement files - Blob WORM] --> REC[Durable Functions reconciliation] --> LED`,
  pts: [r`2,000 TPS is modest; correctness, PCI and availability drive the design.`, r`Idempotency key + unique constraint + outbox in one SQL transaction.`, r`PANs stay out via hosted fields; any CDE gets its own subscription and HSM.`, r`UNKNOWN outcomes resolved by status query or reconciliation, never re-charged.`, r`Zone redundancy plus warm standby; managed identities and private endpoints everywhere.`],
  ex: r`A European PSP on this design absorbed a primary acquirer outage by circuit-breaking to its secondary acquirer within 40 seconds; nightly reconciliation showed zero duplicate charges.`,
  fu: [r`How would you handle multi-currency settlement and FX?`, r`Where would you use Cosmos DB in this design, if anywhere?`],
  pit: [r`Floating-point amounts.`, r`Retrying timed-out authorisations with a new idempotency key.`, r`Public endpoints on PaaS data services.`] },

{ id: 'q39', level: 'Principal', tags: ['finops', 'cost-optimization', 'hybrid-benefit', 'reservations'],
  q: r`Azure spend grew 60% while transactions grew 15%. How do you lead cost optimisation on Azure: visibility, quick wins, commitments (reservations, savings plans, Hybrid Benefit), architecture and governance?`,
  a: r`**1. Visibility**
- **Tagging policy** (owner, service, env, costCenter) enforced and inherited via Azure Policy; subscription per workload makes attribution easy.
- **Cost Management** exports to storage → Power BI/Fabric; budgets and **anomaly alerts** per subscription; **unit economics** (cost per payment, per active customer).

**2. Quick wins**
- **Azure Advisor** cost recommendations: rightsizing VMs, idle resources (unattached disks, unused public IPs, idle App Service plans, empty AKS node pools), shutdown schedules for dev/test VMs.
- Consolidate under-used **App Service plans**; move dev/test to **Dev/Test pricing** subscriptions.
- Log Analytics: sampling, basic/auxiliary logs for verbose data, retention per table, commitment tiers.
- Storage lifecycle to Cool/Cold/Archive; delete old snapshots and backups beyond policy.
- Cosmos DB autoscale max RU right-sized; serverless for spiky low-volume containers; indexing policy trimmed.

**3. Commitments**
- **Reservations** (1 or 3 years, up to about 72% off) for stable resources: VMs, Azure SQL vCores, Cosmos DB RU/s, App Service, Redis.
- **Savings plan for compute** (hourly commitment, up to about 65%, flexible across VM families, regions, App Service Premium, Container Apps dedicated, Functions Premium).
- **Azure Hybrid Benefit**: reuse Windows Server and SQL Server licences with Software Assurance — often the single largest saving for .NET/SQL Server estates (and SQL Managed Instance).
- Commit on the proven baseline (70-80% of steady minimum); review quarterly.

**4. Architecture**
- Move .NET services to Linux containers (no Windows licence), ARM-based (Cobalt/Ampere) VMs where supported.
- **Spot VMs/node pools** for batch, CI and stateless workers.
- Scale to zero for idle workers (Container Apps/Functions); serverless SQL for dev.
- Reduce cross-region and internet egress; private endpoints vs NAT costs; avoid chatty firewall inspection.

**5. Governance**: monthly team cost reviews with unit metrics, cost in pull requests for IaC (Infracost), FinOps champions, budgets per subscription with alerts to owners.`,
  code: r`~~~text
// KQL over Cost Management exports (ingested to Log Analytics / ADX): monthly cost per service tag and cost per payment
CostExport
| where UsageDate >= datetime(2026-01-01)
| extend service = tostring(Tags["service"])
| summarize costEur = sum(CostInBillingCurrency) by month = startofmonth(UsageDate), service
| join kind=inner (Payments | summarize payments = count() by month = startofmonth(Timestamp)) on month
| where service == "payments-platform"
| project month, costEur, payments, costPerPaymentCents = round(100.0 * costEur / payments, 3)
| order by month asc
~~~`,
  dia: r`flowchart LR
  TAG[Tag policy + subscription per workload] --> CM[Cost Management exports]
  CM --> BI[Power BI: unit cost per payment]
  BI --> REV[Monthly team review]
  REV --> QW[Advisor: rightsizing, idle, schedules, logs]
  REV --> COM[Reservations, savings plan, Hybrid Benefit]
  REV --> ARC[Linux containers, Spot, scale to zero, egress]
  AN[Anomaly alerts + budgets] --> REV`,
  pts: [r`Visibility first: tags, subscriptions, exports, unit economics.`, r`Advisor-driven quick wins: rightsizing, idle resources, schedules, logging hygiene.`, r`Reservations, savings plan and Azure Hybrid Benefit on proven baselines.`, r`Architecture: Linux containers, Spot, scale to zero, less egress.`, r`Governance through team reviews, budgets and cost in pull requests.`],
  ex: r`An insurer cut Azure spend 31% in six months: Hybrid Benefit on SQL Managed Instance (12%), reservations and savings plan (9%), Log Analytics changes (5%), idle and dev/test schedules (5%).`,
  fu: [r`How much would you commit to, and over what term?`, r`How do you make cost visible to engineers without blame?`],
  pit: [r`Buying 3-year reservations before rightsizing.`, r`Forgetting Hybrid Benefit on existing licences.`, r`Optimising total spend while ignoring unit cost.`] },

{ id: 'q40', level: 'Principal', tags: ['migration', 'legacy-dotnet', 'sql-managed-instance'],
  q: r`Migrate a large legacy estate — .NET Framework web apps, Windows services, SQL Server with Agent jobs and cross-database queries — to Azure. Which targets, in what sequence, and how do you avoid big-bang cut-overs?`,
  a: r`**Assess first**: **Azure Migrate** for discovery, dependency analysis and right-sizing; the App Service migration assistant / Azure Migrate app assessments for web apps; **Azure SQL migration assessments** (compatibility, SKU recommendations); business-criticality and licensing inventory. Retire unused applications.

**Target mapping**
| Source | First landing | Modernised target |
|---|---|---|
| ASP.NET (.NET Framework) web apps | App Service (Windows) or Windows containers | .NET 8/10 on Linux App Service / Container Apps |
| Windows services, scheduled tasks | VMs or Windows containers | worker services, Functions, Container Apps jobs |
| SQL Server with Agent, cross-DB queries, CLR | **Azure SQL Managed Instance** | Azure SQL Database per service, where justified |
| MSMQ | — | Service Bus |
| File shares | Azure Files | Blob storage |

**Why Managed Instance first**: near-full SQL Server compatibility (Agent, cross-database queries, linked servers, Service Broker), VNet-injected, Hybrid Benefit. **Managed Instance link** replicates from SQL Server 2016+ via distributed availability groups for near-zero-downtime migration (and DR from on-premises), letting you cut over per database when ready. Alternatively **Azure Database Migration Service** (online migration with log shipping).

**Sequence**
1. Landing zone, connectivity (ExpressRoute), identity and DNS first.
2. Rehost/replatform to exit the datacentre on a date: App Service/VMs + MI.
3. Port to modern .NET (Upgrade Assistant, AI-assisted tooling): replace System.Web, WCF services (CoreWCF or gRPC/REST), configuration, Windows-specific APIs.
4. **Strangler fig** behind APIM/Front Door: carve out capabilities into new services with their own data, fed by events (outbox or CDC).
5. Decompose the database last.

**Avoiding big bang**: MI link with per-database cut-over and a reverse path; parallel run for calculation-heavy logic (fees, interest) comparing outputs; feature flags and tenant/region-based routing; rollback plans rehearsed.

**Principal concerns**: business case with milestones (datacentre exit, licence savings), skills and team ramp-up, explicit decisions about what stays rehosted, stop points delivering value.`,
  code: r`~~~csharp
// Strangler routing in front of the legacy app (YARP in a .NET gateway, or equivalent APIM policies)
builder.Services.AddReverseProxy().LoadFromMemory(
    [
        new RouteConfig { RouteId = "statements", ClusterId = "statements-new", Match = new() { Path = "/api/statements/{**rest}" } },
        new RouteConfig { RouteId = "legacy", ClusterId = "legacy", Order = 1000, Match = new() { Path = "{**all}" } }
    ],
    [
        new ClusterConfig { ClusterId = "statements-new", Destinations = new Dictionary<string, DestinationConfig> { ["a"] = new() { Address = "https://ca-statements.internal/" } } },
        new ClusterConfig { ClusterId = "legacy", Destinations = new Dictionary<string, DestinationConfig> { ["a"] = new() { Address = "https://app-legacy-portal.azurewebsites.net/" } } }
    ]);
~~~
~~~sql
-- After MI link cut-over: confirm Agent jobs migrated and enabled
SELECT j.name, j.enabled, s.next_run_date, s.next_run_time
FROM msdb.dbo.sysjobs j JOIN msdb.dbo.sysjobschedules s ON s.job_id = j.job_id
ORDER BY j.name;
~~~`,
  dia: r`flowchart LR
  ONP[(On-prem SQL Server 2019)] -->|MI link: distributed AG| MI[(Azure SQL Managed Instance)]
  U[Users] --> GW[Front Door / APIM - strangler routing]
  GW -->|/api/statements| NEW[Statements service - .NET 8, Container Apps]
  GW -->|everything else| OLD[Legacy ASP.NET app - App Service Windows]
  OLD --> MI
  MI -->|CDC / outbox events| NEW`,
  pts: [r`Assess with Azure Migrate and SQL assessments; retire first.`, r`Managed Instance for SQL Server compatibility; MI link for near-zero-downtime cut-over.`, r`Rehost/replatform to exit, then port to modern .NET on Linux.`, r`Strangler fig behind a gateway; decompose data last.`, r`Parallel runs, feature flags and rehearsed rollback instead of big bang.`],
  ex: r`A building society moved 140 SQL Server databases to Managed Instance using MI link with per-application cut-over windows of under 15 minutes, then modernised its customer portal over 18 months.`,
  fu: [r`When is Azure SQL Database a better target than Managed Instance?`, r`How do you migrate WCF services?`],
  pit: [r`Targeting Azure SQL Database first for apps using Agent and cross-database queries.`, r`Rewriting everything before exiting the datacentre.`, r`Ignoring licence costs and Hybrid Benefit.`] },

{ id: 'q41', level: 'Principal', tags: ['compliance', 'pci-dss', 'eu-data-boundary', 'audit'],
  q: r`Meet PCI DSS, SOX change control and EU data-residency obligations on Azure. Explain shared responsibility, scope reduction, the EU Data Boundary, and continuous compliance evidence.`,
  a: r`**Shared responsibility**: Microsoft attests the platform (PCI DSS service provider, SOC 1/2/3, ISO 27001/27017/27018, C5) via the **Service Trust Portal**. Your configuration, identities, network, data handling and SDLC are what auditors and QSAs test.

**PCI DSS: reduce scope first**
- Keep PANs out with PSP hosted fields / network tokens; then only the payment page and an adapter are in scope.
- If you hold card data: a **dedicated CDE subscription** under its own management group with the **PCI DSS v4 policy initiative**, isolated spoke, private endpoints only, Managed HSM/Payment HSM keys, Defender plans on, FIM and vulnerability scanning, MFA for all CDE access via PIM, and log retention of at least 12 months (3 immediately available).

**SOX ITGC**: changes only via reviewed pipelines with segregation of duties, production access via PIM with approval, access reviews quarterly, break-glass monitoring; evidence = pull requests, pipeline logs, Activity Log, PIM audit history.

**Data residency**
- **Allowed locations** policy at the management group (EU regions only); restrict resource-group locations too.
- Verify where each service stores data — some telemetry or global services (Front Door logs, Entra ID, support diagnostics) have specific residency statements.
- **EU Data Boundary**: Microsoft's commitment to store and process customer data and personal data for EU/EFTA customers within the EU for core cloud services (completed in phases through 2025). Know its documented exceptions and do not over-claim it.
- Customer Lockbox for Microsoft support access approval; CMK for sovereignty-sensitive data; consider sovereign offerings where regulation requires.

**Continuous compliance**
- **Defender for Cloud regulatory compliance** dashboards (PCI DSS, ISO 27001, CIS benchmarks) driven by policy assessments.
- **Azure Policy** for preventive controls; exemptions with expiry and owners.
- **Microsoft Purview** for data classification and lineage (where are PANs/PII?).
- Immutable log storage (Log Analytics with long retention + export to immutable Blob); Sentinel for monitoring.
- Control owners with automated checks and dashboards; audits become evidence exports, not projects.`,
  code: r`~~~bash
# Assign the built-in PCI DSS v4 initiative at the CDE management group (look up its ID by display name)
PCI_V4_ID=$(az policy set-definition list --query "[?displayName=='PCI DSS v4'].name | [0]" -o tsv)
az policy assignment create --name pci-dss-v4 --display-name "PCI DSS v4" \
  --scope /providers/Microsoft.Management/managementGroups/cde \
  --policy-set-definition "$PCI_V4_ID" --mi-system-assigned --location westeurope

az policy assignment create --name allowed-locations-eu \
  --scope /providers/Microsoft.Management/managementGroups/landingzones \
  --policy "e56962a6-4747-49cd-b67b-bf8b01975c4c" \
  --params '{ "listOfAllowedLocations": { "value": ["westeurope", "northeurope", "germanywestcentral"] } }'
# e56962a6-... is the built-in "Allowed locations" policy definition.
~~~`,
  dia: r`flowchart TB
  subgraph CDE[CDE subscription - PCI DSS v4 initiative]
    TOK[Tokenisation] --> HSM[Managed HSM / Payment HSM]
  end
  subgraph CORP[Corp subscriptions - tokens only, out of scope]
    API[Payments API]
  end
  PSP[PSP hosted fields] --> TOK
  API -->|private endpoint, tokens| TOK
  POL[Azure Policy: allowed locations EU, deny public] --> CDE
  POL --> CORP
  DFC[Defender for Cloud compliance dashboard] --> EV[Audit evidence]
  LOGS[Activity Log, PIM, pipelines] --> EV`,
  pts: [r`Microsoft attests the platform; your controls are what gets assessed.`, r`Shrink PCI scope with hosted fields; isolate any CDE in its own subscription and management group.`, r`SOX via reviewed pipelines, PIM and access reviews.`, r`Residency through allowed-locations policy; understand the EU Data Boundary and its exceptions.`, r`Continuous compliance with Defender dashboards, Policy, Purview and immutable logs.`],
  ex: r`A payments company replaced a two-month annual evidence hunt with Defender for Cloud compliance exports plus pipeline and PIM logs; the QSA sampled controls directly from dashboards.`,
  fu: [r`How do you prove no PAN appears in Application Insights telemetry?`, r`What does Customer Lockbox protect against, and what not?`],
  pit: [r`Claiming PCI compliance because Azure is PCI certified.`, r`Over-claiming the EU Data Boundary.`, r`Manual, once-a-year evidence collection.`] },

{ id: 'q42', level: 'Principal', tags: ['aws-comparison', 'multi-cloud', 'architecture'],
  q: r`You know AWS deeply. Map the core Azure services to AWS and, more importantly, explain the genuine architectural divergences an architect must not paper over.`,
  a: r`**Quick map**
| Concern | AWS | Azure |
|---|---|---|
| Account boundary | Account, OU, SCP | Subscription, management group, Azure Policy |
| Identity for workloads | IAM roles, IRSA/Pod Identity | Managed identities, workload identity federation |
| Network | VPC (AZ-scoped subnets), TGW, PrivateLink | VNet (regional subnets), hub-spoke/Virtual WAN, Private Endpoint |
| L7 global / regional | CloudFront + WAF / ALB | Front Door / Application Gateway |
| Containers | ECS, EKS, Fargate | Container Apps, AKS |
| Serverless | Lambda, Step Functions | Functions, Durable Functions, Logic Apps |
| Relational | RDS, Aurora | Azure SQL (DB/MI), Azure Database for PostgreSQL |
| NoSQL | DynamoDB | Cosmos DB |
| Messaging | SQS/SNS, EventBridge, Kinesis/MSK | Service Bus, Event Grid, Event Hubs |
| Secrets/keys | Secrets Manager, KMS, CloudHSM | Key Vault, Managed HSM |
| Observability | CloudWatch, X-Ray, CloudTrail | Azure Monitor, Application Insights, Activity Log |
| IaC | CloudFormation/CDK | ARM/Bicep |

**Genuine divergences**
1. **Identity model**: Azure separates a tenant-wide directory (Entra ID) from resource containers, and uses **OAuth tokens for everything** (including calling Azure services); AWS uses IAM per account and **SigV4** signing. Policy design, cross-boundary access and incident containment differ accordingly (removing role assignments vs revoking sessions).
2. **Authorisation semantics**: AWS IAM policies have explicit deny and rich conditions on every call; Azure RBAC is **additive**, with deny only through deny assignments and Azure Policy at deployment time. Data-plane RBAC must be enabled per service and key-based auth disabled.
3. **Networking**: Azure subnets span zones; many PaaS services live outside your VNet and join via private endpoints with **DNS as the main failure mode**; SNAT exhaustion is a recurring Azure App Service issue with no direct AWS analogue.
4. **Governance**: Azure Policy can **modify and deploy** resources (DINE), combining SCP-like prevention with Config-like remediation.
5. **Data services**: Cosmos DB offers five consistency levels and multi-region writes with LWW; DynamoDB offers eventual/strong reads and global tables. Azure SQL has first-class SQL Server compatibility (MI, Always Encrypted, Hybrid Benefit) — often decisive for .NET estates.
6. **Messaging**: Service Bus is a full-featured broker (sessions, transactions, deferral, duplicate detection) where AWS composes SQS + SNS + EventBridge.
7. **Regions**: region pairs and sequenced updates exist on Azure; AWS has no pairs.
8. **PaaS for .NET**: App Service with slots and Functions isolated worker are mature first-party .NET paths; AWS's equivalents are less central.

**Architect's stance**: do not design to the lowest common denominator; adopt each cloud's idioms, keep application code portable (containers, OpenTelemetry, standard protocols) and know where the operational models differ.`,
  code: r`~~~csharp
// Same intent, different idioms: credentials come from the platform in both, but the auth model differs
// AWS: SigV4 with role credentials from the default provider chain
var s3 = new AmazonS3Client();                                    // task role / Pod Identity
await s3.GetObjectAsync("statements-prod", key);

// Azure: OAuth bearer token from a managed identity; data-plane RBAC must allow it
var blob = new BlobClient(new Uri($"https://stpaymentsprod.blob.core.windows.net/statements/{key}"),
                          new ManagedIdentityCredential(clientId));
await blob.DownloadContentAsync();
~~~`,
  dia: r`flowchart LR
  subgraph AWS
    A1[Account + SCP] --> A2[IAM role - SigV4]
    A2 --> A3[S3 / DynamoDB / SQS]
  end
  subgraph Azure
    Z0[Entra tenant - OAuth tokens] --> Z2[Managed identity]
    Z1[Subscription + Azure Policy] --> Z3[Storage / Cosmos / Service Bus - data-plane RBAC]
    Z2 --> Z3
  end
  APP[Portable .NET code: containers, OTel, config] --> A2
  APP --> Z2`,
  pts: [r`Map services quickly, then focus on divergences.`, r`Identity: tenant-wide Entra + OAuth vs per-account IAM + SigV4.`, r`RBAC is additive; Azure Policy can modify and deploy.`, r`Networking: regional subnets, private endpoint DNS, SNAT.`, r`Data and messaging semantics differ; adopt each cloud's idioms, keep code portable.`],
  ex: r`A bank's multi-cloud team copied AWS network designs into Azure (one subnet per zone, no private DNS strategy); private endpoint failures followed until they redesigned around central privatelink zones.`,
  fu: [r`Which AWS habit causes the most problems on Azure?`, r`How would you write an exit plan from Azure to AWS for one critical service?`],
  pit: [r`Assuming one-to-one equivalence.`, r`Designing to the lowest common denominator.`, r`Ignoring the identity-model difference during incident response.`] },

{ id: 'q43', level: 'Principal', tags: ['platform-strategy', 'adr', 'app-service', 'aks'],
  q: r`Thirty .NET teams need a standard hosting platform on Azure: App Service, Container Apps or AKS? Write the ADR — context, criteria, decision, consequences and revisit triggers.`,
  a: r`**Context**: 30 teams, mostly ASP.NET Core APIs and Service Bus workers, some batch; a 6-person platform team; PCI/SOX obligations; goals: reduce toil, faster onboarding, predictable cost, strong network isolation.

**Criteria and options**
| Criterion | App Service | Container Apps | AKS |
|---|---|---|---|
| Ops burden | very low | low | high |
| Network isolation | Premium + VNet integration/private endpoints, or ASE v3 | internal environments, UDR egress | full control, private cluster |
| Event-driven workers | WebJobs/limited | KEDA, scale to zero, jobs | KEDA + node autoscaling |
| Deployment safety | slots + swap | revisions + weighted traffic | any (Argo Rollouts, Flagger) |
| Ecosystem/extensibility | limited | Dapr, no K8s API | full Kubernetes |
| Skills required | low | low-medium | high |

**Decision** (typical for this context): **Container Apps as the default** for services and workers (containers as the unit, KEDA scaling, revisions for canaries, internal environments per landing zone), **App Service** acceptable for simple web apps already there, **AKS by exception** for workloads needing Kubernetes APIs (operators, service mesh, custom controllers) where the requesting team funds operations. Golden paths: Bicep/AVM modules, pipeline templates, OpenTelemetry, managed identity, private networking by default.

**Why not AKS for everyone**: the platform team would spend its capacity on upgrades, add-ons and multi-tenancy rather than developer experience. **Why not App Service for everyone**: weaker fit for queue workers and scale-to-zero, less container-native.

**Consequences**
- Positive: one paved road, little cluster toil, consistent security defaults, quicker onboarding.
- Negative: Container Apps platform limits; some teams will want AKS features; Azure-specific constructs (mitigated by containers + Dapr/OpenTelemetry for portability).
- Revisit: platform team > 15 engineers, > 25% of teams requesting exceptions, a regulatory portability mandate, or a Container Apps limit blocking a critical workload.`,
  code: r`~~~markdown
# ADR-022: Default hosting platform on Azure
Status: Accepted (2026-10-11)   Owner: Platform architecture
## Context
30 .NET teams, 6 platform engineers, PCI + SOX, isolation and toil-reduction goals.
## Decision
Default: Azure Container Apps (internal environment per landing zone) via golden-path modules.
Allowed: App Service Premium for existing simple web apps.
Exception: AKS, approved by architecture review, requesting team funds operations.
## Consequences
+ No cluster lifecycle for most teams; built-in canary via revisions; KEDA for workers.
- Platform limits; Azure-specific constructs (portability via containers, OTel, Dapr).
## Revisit when
Platform team > 15, exceptions > 25% of teams, portability mandate, or a blocking platform limit.
~~~`,
  dia: r`flowchart TD
  W[New workload] --> Q1{Simple web app already on App Service?}
  Q1 -->|yes| AS[App Service Premium]
  Q1 -->|no| Q2{Needs Kubernetes APIs - operators, CRDs, mesh?}
  Q2 -->|no| CA[Container Apps - default golden path]
  Q2 -->|yes| REV[Architecture review exception]
  REV -->|approved, team funds ops| AKS[AKS]`,
  pts: [r`Tie the decision to team size, skills, regulation and workload mix.`, r`Container Apps default, App Service where it already fits, AKS by exception is common.`, r`Golden paths make the default easiest.`, r`State consequences and portability mitigations.`, r`Define revisit triggers.`],
  ex: r`A bank standardised on Container Apps with an AKS exception path; 22 of 30 teams onboarded within a year and the platform team stopped spending sprints on cluster upgrades.`,
  fu: [r`What signals would tell you the default is wrong?`, r`How do you handle a team that wants AKS for career reasons?`],
  pit: [r`Choosing by fashion.`, r`No exception path, creating shadow platforms.`, r`Ignoring the platform team's capacity.`] },

{ id: 'q44', level: 'Principal', tags: ['multi-tenancy', 'saas', 'deployment-stamps', 'isolation'],
  q: r`Design a multi-tenant B2B SaaS on Azure (for example, a treasury management platform for corporates): tenancy models, data isolation options in Azure SQL and Cosmos DB, Entra multi-tenant identity, deployment stamps, and noisy neighbours.`,
  a: r`**Tenancy models**: **pooled** (shared everything, tenant id everywhere), **siloed** (dedicated stack/subscription per tenant), and **hybrid** by tier — standard tenants pooled, premium/regulated banks siloed with their own keys and possibly region.

**Deployment stamps**: identical scale units (a stamp = compute + database + messaging) each hosting a set of tenants, with a global **tenant catalogue** and routing layer (Front Door + a lightweight router). Stamps cap blast radius, give known tested capacity, and let you place tenants by region for residency. Similar to AWS cell-based architecture.

**Data isolation options**
| Option | Isolation | Cost | Notes |
|---|---|---|---|
| Shared tables + {{TenantId}} + **row-level security** | logical | lowest | RLS predicates via {{SESSION_CONTEXT}}; must be set on every connection |
| Schema per tenant | medium | low-medium | migrations × tenants |
| **Database per tenant in elastic pools** | strong | medium | per-tenant restore, move, CMK possible; the classic SaaS pattern on Azure SQL |
| Dedicated server/MI per tenant | strongest | high | for silo tier |
| Cosmos DB: partition key per tenant (hierarchical keys) vs container/account per tenant | logical to strong | varies | per-account for silo tenants with their own CMK |

**Identity**: an Entra **multi-tenant app registration** lets corporate customers sign in with their own Entra tenants (admin consent per customer); map the token's {{tid}} claim to your tenant catalogue — never trust a tenant id from the request body. Customer identities outside Entra via Entra External ID or federation (SAML/OIDC).

**Noisy neighbours**: per-tenant rate limits (APIM rate-limit-by-key on tenant id), per-tenant queues or fair scheduling, Cosmos RU budgets per tenant (hierarchical keys + throughput buckets), elastic pool per-database min/max vCore settings, moving heavy tenants to their own stamp.

**Operations**: tenant-aware telemetry (tenant id in traces/logs, tier-level metrics), per-tenant cost metering for pricing, automated onboarding (Durable Functions provisioning database, keys, catalogue entry), schema migrations rolled out per stamp with canary tenants.`,
  code: r`~~~sql
-- Row-level security for the pooled tier: every query filtered by tenant from SESSION_CONTEXT
CREATE SCHEMA sec;
GO
CREATE FUNCTION sec.fn_tenant_filter(@TenantId uniqueidentifier)
RETURNS TABLE WITH SCHEMABINDING
AS RETURN SELECT 1 AS allowed WHERE @TenantId = CAST(SESSION_CONTEXT(N'TenantId') AS uniqueidentifier);
GO
CREATE SECURITY POLICY sec.TenantPolicy
  ADD FILTER PREDICATE sec.fn_tenant_filter(TenantId) ON dbo.CashPositions,
  ADD BLOCK  PREDICATE sec.fn_tenant_filter(TenantId) ON dbo.CashPositions
  WITH (STATE = ON);
~~~
~~~csharp
// EF Core interceptor sets the tenant from the validated token's tid claim on every connection open
public sealed class TenantSessionInterceptor(ITenantContext tenant) : DbConnectionInterceptor
{
    public override async Task ConnectionOpenedAsync(DbConnection conn, ConnectionEndEventData data, CancellationToken ct = default)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "EXEC sp_set_session_context @key = N'TenantId', @value = @t, @read_only = 1";
        var p = cmd.CreateParameter(); p.ParameterName = "@t"; p.Value = tenant.TenantId; cmd.Parameters.Add(p);
        await cmd.ExecuteNonQueryAsync(ct);
    }
}
~~~`,
  dia: r`flowchart LR
  U[Corporate users - own Entra tenants] --> FD[Front Door]
  FD --> RT[Tenant router + catalogue]
  RT -->|tenants A-M| ST1[Stamp 1 WEU: Container Apps + elastic pool]
  RT -->|tenants N-Z| ST2[Stamp 2 WEU]
  RT -->|premium bank| SILO[Silo stamp: dedicated SQL + own CMK]
  CAT[(Tenant catalogue)] -.-> RT`,
  pts: [r`Pooled, siloed and hybrid tenancy by tier.`, r`Deployment stamps cap blast radius and support residency placement.`, r`Azure SQL: RLS for pooled, database-per-tenant in elastic pools as the classic pattern.`, r`Multi-tenant Entra apps: map tid to the catalogue, never trust request input.`, r`Noisy-neighbour controls, tenant-aware telemetry and metering.`],
  ex: r`A treasury SaaS moved its three largest bank clients to dedicated stamps with their own Key Vault keys; their contract renewals required it, and pooled-tier latency improved as a side effect.`,
  fu: [r`How do you move a tenant between stamps without downtime?`, r`What happens if the SESSION_CONTEXT is not set on a pooled connection?`],
  pit: [r`Tenant id taken from request parameters.`, r`RLS without making session context read-only.`, r`One giant shared database with no stamp strategy.`] },

{ id: 'q45', level: 'Principal', tags: ['hybrid', 'expressroute', 'azure-arc', 'dns'],
  q: r`Connect Azure to on-premises core banking: ExpressRoute resiliency and encryption, VPN backup, hybrid DNS, Azure Arc for hybrid operations, and protecting on-premises systems from cloud-scale load.`,
  a: r`**ExpressRoute**: a private connection via a connectivity provider to a Microsoft **peering location**. Each circuit has two connections (primary/secondary) to two Microsoft edge routers.
- **Resiliency**: a single circuit protects against one link failure but not a peering-location failure. For critical workloads use **two circuits in two different peering locations** (maximum resiliency), each connected to the ExpressRoute gateway, and **zone-redundant gateway** SKUs.
- **ExpressRoute Direct** for 10/100 Gbps dedicated ports; **Global Reach** to connect on-premises sites through Microsoft's backbone; **FastPath** to bypass the gateway for high throughput.
- **Encryption**: ExpressRoute is private, not encrypted by default — **MACsec** on ExpressRoute Direct, and/or **IPsec VPN over ExpressRoute** private peering; TLS end to end regardless.
- **Site-to-Site VPN** as a backup path (BGP failover), or ExpressRoute + VPN coexistence on the same gateway subnet.

**Hybrid DNS**: **Azure DNS Private Resolver** inbound endpoint (on-premises forwards Azure private zones, including privatelink zones) and outbound endpoint with forwarding rulesets for on-premises domains (linked to spokes). DNS is the most common hybrid outage cause — test both directions.

**Azure Arc**: projects on-premises servers, Kubernetes clusters and SQL Servers into ARM — apply Azure Policy, Defender for Cloud, Update Manager, monitoring and RBAC consistently across estates; Arc-enabled SQL Server for inventory, best-practice assessment and licensing (pay-as-you-go via Azure).

**Protecting fixed-capacity systems** (mainframe/core banking with limited MIPS or connection pools)
- Queue-based load levelling (Service Bus) and adapters with **bounded concurrency** and circuit breakers between elastic cloud services and the core.
- **Read offload**: CDC or event feeds from the core into Azure read models (SQL/Cosmos), so channels read in Azure and only writes cross to the core.
- Respect batch windows; schedule bulk operations; idempotent interfaces with business references so retries do not double-post.
- Capacity agreements and synthetic monitoring of the core interfaces.

**AWS mapping**: ExpressRoute ≈ Direct Connect; maximum resiliency patterns are similar; Arc ≈ Systems Manager hybrid + EKS Anywhere-style management (Arc is broader in policy integration); DNS Private Resolver ≈ Route 53 Resolver endpoints.`,
  code: r`~~~csharp
// Adapter in front of the core banking gateway: bounded concurrency, timeouts, breaker, idempotent reference
builder.Services.AddResiliencePipeline("core", p => p
    .AddConcurrencyLimiter(permitLimit: 40, queueLimit: 400)          // core gateway: ~50 sessions
    .AddTimeout(TimeSpan.FromSeconds(4))
    .AddCircuitBreaker(new() { FailureRatio = 0.3, MinimumThroughput = 30, BreakDuration = TimeSpan.FromSeconds(30) }));

public async Task<PostingResult> PostAsync(Posting p, CancellationToken ct) =>
    await _pipelines.GetPipeline("core").ExecuteAsync(async token =>
        await _core.PostAsync(p with { BusinessRef = $"PAY-{p.PaymentId:N}" }, token), ct);   // core dedupes on BusinessRef
~~~`,
  dia: r`flowchart LR
  subgraph Azure
    CH[Channel services - autoscaled] --> SB[(Service Bus buffer)] --> AD[Core adapter - max 40 concurrent]
    RM[(Read models)]
    RES[DNS Private Resolver]
    GW[ER gateway - zone-redundant]
  end
  AD --> GW
  GW -->|circuit 1: peering location A| DC[On-prem datacentre]
  GW -->|circuit 2: peering location B| DC
  GW -.VPN backup.-> DC
  DC --> CORE[Core banking / mainframe]
  CORE -->|CDC| RM
  RES <-->|forwarding| DNS[Corporate DNS]
  ARC[Azure Arc: policy, Defender, updates] -.-> DC`,
  pts: [r`Two ExpressRoute circuits in two peering locations for critical traffic; zone-redundant gateways.`, r`Encrypt with MACsec or IPsec over ExpressRoute.`, r`DNS Private Resolver for both directions of hybrid DNS.`, r`Azure Arc extends policy, security and operations to on-premises.`, r`Queues, bounded adapters and CDC read offload protect fixed-capacity cores.`],
  ex: r`A bank's mobile channel on Azure overloaded the mainframe on salary day; Service Bus buffering, a 40-session adapter and CDC read models cut mainframe peak load by 70%.`,
  fu: [r`How do you test ExpressRoute failover safely?`, r`What breaks first when on-premises DNS cannot resolve privatelink zones?`],
  pit: [r`A single ExpressRoute circuit for critical traffic.`, r`Assuming ExpressRoute is encrypted.`, r`Cloud autoscaling directly against a fixed-capacity core.`] },

{ id: 'q46', level: 'Principal', tags: ['architecture-review', 'anti-patterns', 'well-architected'],
  q: r`Review this Azure design: one App Service (Basic tier, single instance) hosts the API and a timer job, connects to Azure SQL (General Purpose, public endpoint, SQL admin password in app settings), reads Blob Storage with an account key, logs to local files, uses ARR affinity, and is deployed by publishing from Visual Studio. Prioritise findings and give a remediation plan.`,
  a: r`Structure by the **Azure Well-Architected Framework** pillars (reliability, security, cost, operational excellence, performance), then prioritise by risk × likelihood.

**Critical (this week)**
1. **Security — SQL admin password and storage account key in app settings**: long-lived, over-privileged secrets. → Managed identity; Entra-only authentication on SQL with a least-privilege contained user; disable shared key access on storage and use data-plane RBAC; rotate the existing password and keys; review SQL audit logs for misuse.
2. **Security — public SQL endpoint**: → private endpoint + VNet integration, disable public network access, central privatelink DNS.
3. **Reliability — single Basic instance, no zone redundancy, no SLA-grade setup**: → Premium v3 plan with zone redundancy (≥3 instances), health check, Always On; consider Business Critical zone-redundant or at least zone-redundant General Purpose for SQL; failover group if RTO demands.

**High (this month)**
4. **Operational excellence — publishing from Visual Studio**: no review, no audit, no rollback (SOX finding). → CI/CD with workload identity federation, slots and swap, approvals.
5. **Observability — local log files**: lost on instance replacement; no alerting. → Application Insights (OpenTelemetry distro), Log Analytics, SLO alerts, diagnostic settings.
6. **Timer job in the API**: scales with the API (runs N times when scaled out) and is killed on swaps/restarts. → Functions timer or Container Apps job, idempotent, single execution.
7. **ARR affinity on**: uneven load, breaks failover; → stateless API, distributed cache for any session state.

**Medium (this quarter)**
8. IaC (Bicep/AVM) for reproducible environments; Azure Policy guardrails.
9. Cost: right-size after stabilising, reservations/savings plan, Hybrid Benefit if Windows/SQL licences exist.
10. Front Door + WAF if internet-facing.

**Presenting it**: a risk register (finding, pillar, impact, likelihood, owner, date), quick wins first, target architecture, and acknowledgement that the current system delivers value — sequence changes so each step is safe and independently shippable.`,
  code: r`~~~text
Finding                              Pillar        Risk      Fix                                         Owner  Due
SQL admin password in app settings   Security      Critical  Managed identity + Entra-only auth          Team   +3d
Storage account key                  Security      Critical  Disable shared key, data-plane RBAC          Team   +3d
Public SQL endpoint                  Security      Critical  Private endpoint, public access disabled     Platf  +7d
Single Basic instance                Reliability   Critical  P1v3 zone-redundant x3, health check         Team   +14d
VS publish deployments               Ops / SOX     High      Pipeline + OIDC + slots + approvals          Team   +30d
Local log files                      Ops           High      App Insights OTel + SLO alerts               Team   +30d
Timer job inside API                 Reliability   High      Functions timer / Container Apps job         Team   +30d
ARR affinity on                      Performance   High      Disable; externalise session state           Team   +14d
No IaC / policy                      Ops           Medium    Bicep + AVM + Azure Policy                   Team   +90d
~~~`,
  dia: r`flowchart LR
  subgraph Before
    I[Internet] --> AS1[App Service Basic x1: API + timer, ARR, local logs]
    AS1 -->|admin password, public endpoint| SQL1[(Azure SQL GP)]
    AS1 -->|account key| ST1[(Blob)]
  end
  subgraph After
    I2[Internet] --> FD[Front Door + WAF]
    FD --> AS2[App Service P1v3 zone-redundant x3, slots]
    AS2 -->|managed identity, private endpoint| SQL2[(Azure SQL zone-redundant)]
    AS2 -->|RBAC, private endpoint| ST2[(Blob)]
    FN[Functions timer job] --> SQL2
    AS2 --> AI[Application Insights]
  end`,
  pts: [r`Structure by Well-Architected pillars; prioritise by risk and likelihood.`, r`Secrets and public endpoints first: managed identity, Entra-only SQL, no shared keys, private endpoints.`, r`Reliability next: zone-redundant Premium plan, health checks, resilient SQL tier.`, r`Then delivery and operations: pipelines, telemetry, separated jobs, stateless API.`, r`Present a risk register and an incremental, safe sequence.`],
  ex: r`On a similar review, SQL audit logs showed the leaked-prone admin login had been used from an unknown IP weeks earlier — rotating it on day one turned out to be urgent, not hygiene.`,
  fu: [r`What would you check in the first hour if you suspected credential misuse?`, r`How do you get the team to own the plan?`],
  pit: [r`Leading with refactoring or cost while secrets are exposed.`, r`An unprioritised list of 40 findings.`, r`Recommending a rewrite.`] },

{ id: 'q47', level: 'Principal', tags: ['regional-outage', 'control-plane', 'entra-dependency', 'static-stability'],
  q: r`An Azure region suffers a multi-hour impairment, and separately a global identity incident delays token issuance. Explain control-plane versus data-plane dependencies on Azure, hidden global dependencies like Entra ID and Front Door, and how you design for both.`,
  a: r`**Control plane vs data plane**
- **Control plane**: ARM operations — create, scale, configure, deploy, change role assignments or DNS.
- **Data plane**: serving traffic — an App Service instance handling requests, a SQL query, a Service Bus receive.
During incidents control planes often degrade first: autoscale cannot add instances, deployments fail, failover operations queue. A design that needs ARM operations to recover is not **statically stable**.

**Hidden dependencies to inventory**
- **Entra ID token issuance**: every managed identity, Key Vault call, Storage/Service Bus/SQL connection with Entra auth depends on getting tokens. SDKs cache tokens (typically valid for an hour or more) and refresh early, so running apps survive short outages — **cold-starting** apps and new instances do not. Entra has regional resilience and a backup authentication service for many scenarios, but plan for degraded issuance.
- **Global services**: Front Door, Traffic Manager, Entra ID, Azure DNS — highly available but global blast radius. For critical internet entry consider a documented fallback (Traffic Manager or DNS-level switch to regional App Gateway endpoints).
- Start-up dependencies: Key Vault references and App Configuration fetched at start — if unreachable, new instances fail. Cache last-known-good configuration, ship safe defaults.
- Third-party SaaS (IdP, feature flags, observability, CI/CD) in the same region.
- Your own shared services (a central API gateway, a single APIM region).

**Designing for regional impairment**
1. Criticality tiers with RTO per capability; multi-region only where justified (q37).
2. **Pre-provisioned capacity**: N-1 zone capacity in-region; warm standby in another region with minimum instance counts — do not depend on scaling during the event.
3. Data-plane failover: Front Door health-probe-based routing, failover-group listeners, Cosmos automatic failover — avoid DNS edits or role changes during the incident.
4. **Degrade gracefully**: serve cached reads, queue writes, disable non-essential features with locally evaluated flags.
5. Identity resilience: long-lived processes reuse tokens; avoid per-request token acquisition; break-glass accounts excluded from Conditional Access dependencies.
6. Rehearse: regional game days including "no ARM changes possible" and "token refresh failing" scenarios; a communications plan.

**AWS parallel**: the same principle (static stability) applies to AWS; the specific global dependencies differ (IAM/STS in us-east-1 vs Entra ID globally).`,
  code: r`~~~csharp
// Fail static on configuration: last-known-good values survive config-store or identity outages
builder.Configuration.AddAzureAppConfiguration(o =>
{
    o.Connect(new Uri("https://appcs-payments-prod.azconfig.io"), credential)
     .Select("Payments:*")
     .ConfigureRefresh(r => r.Register("Payments:Sentinel", refreshAll: true).SetRefreshInterval(TimeSpan.FromMinutes(5)))
     .ConfigureStartupOptions(s => s.Timeout = TimeSpan.FromSeconds(10));
}, optional: true);                                              // do not crash start-up if the store is unreachable
builder.Configuration.AddJsonFile("appsettings.safe-defaults.json", optional: false); // shipped in the image

// Reuse credentials and clients: tokens are cached and refreshed early by Azure.Identity
builder.Services.AddSingleton<TokenCredential>(new ManagedIdentityCredential(clientId));
~~~`,
  dia: r`flowchart TB
  subgraph R1[West Europe - impaired]
    APP1[Running instances - cached tokens, keep serving]
    ARM1[ARM control plane - scale and deploy failing]
  end
  subgraph R2[North Europe - warm standby, pre-scaled]
    APP2[Full stack, min instances set]
  end
  FD[Front Door - health probes] -->|shift traffic| APP2
  FD -.-> APP1
  ENTRA[Entra ID token issuance] -.cached tokens bridge short outages.-> APP1
  ENTRA -.-> APP2`,
  pts: [r`Control planes degrade first; recovery must rely on data planes.`, r`Entra token issuance is a hidden dependency; cached tokens help running apps, not cold starts.`, r`Inventory global and start-up dependencies; fail static on config.`, r`Pre-provision capacity and use data-plane failover.`, r`Rehearse no-ARM and token-failure scenarios.`],
  ex: r`During an identity incident a firm's long-running services kept working on cached tokens, but autoscaled new instances failed to start; it raised minimum instances and shipped safe-default configuration in images.`,
  fu: [r`What would fail first in your estate if Entra ID token issuance stalled for 2 hours?`, r`When is a fallback around Front Door worth its complexity?`],
  pit: [r`Recovery plans that need ARM operations.`, r`Acquiring tokens per request.`, r`Hard start-up dependencies on remote configuration.`] },

{ id: 'q48', level: 'Principal', tags: ['governance', 'platform-engineering', 'policy-as-code', 'golden-paths'],
  q: r`You own Azure governance for 300 engineers across 120 subscriptions. How do you balance autonomy and control using landing zones, policy as code, golden paths, exceptions and metrics?`,
  a: r`**Principle**: make the secure, compliant path the easiest path; reserve human review for genuinely high-risk decisions.

**Layers**
1. **Preventive**: Azure Policy at management groups — allowed locations, deny public network access on PaaS in Corp, require private endpoints, deny classic resources, require tags, deny-action on deleting critical resources; RBAC through groups and PIM; deployment-stack deny settings for platform resources.
2. **Paved road**: **Azure Verified Modules** wrapped in company modules ("service", "worker", "database", "event-driven app") with private networking, managed identity, diagnostics, backup and tagging built in; pipeline templates; a developer portal (Backstage or **Azure Deployment Environments** for self-service sandboxes) and subscription vending.
3. **Detective**: Defender for Cloud secure score and recommendations, policy compliance, Activity Log alerts, cost anomalies — routed to owning teams with remediation SLAs, not to a central queue.

**Policy as code**: definitions, initiatives, assignments and exemptions in Git (Enterprise Policy as Code or Bicep/Terraform), pull-request review, staged rollout (Audit → canary management group → Deny), automated tests for policy effects.

**Exceptions**: time-bound **policy exemptions** with an ADR, risk owner, compensating controls and expiry; dashboards of exemptions. Many exemptions against one rule mean the rule or the golden path needs fixing.

**Team autonomy**: teams own their subscriptions and services inside guardrails ("you build it, you run it"); the platform team runs platforms as products with roadmaps based on developer feedback.

**Metrics**
- Delivery (DORA): lead time, deploy frequency, change failure rate, time to restore — governance must not degrade them.
- Safety: secure score, critical findings and time to remediate, % of workloads on golden paths, open exemptions.
- Developer experience: time to first production deployment for a new service, survey results.

**Anti-pattern**: an architecture board approving every change. Replace with published standards, golden paths and targeted reviews (new regulated data stores, internet exposure, cross-tenant trust, new identity flows).`,
  code: r`~~~bicep
// Company golden-path module: teams declare intent; security defaults come for free
module svc 'br:acrplatform.azurecr.io/bicep/modules/containerapp-service:2.3.0' = {
  name: 'payments-api'
  params: {
    name: 'payments-api'
    ownerTeam: 'payments'
    costCenter: 'CC-410'
    environmentId: caeCorpProd.id             // internal environment in the Corp landing zone
    image: 'acrpayments.azurecr.io/payments-api@sha256:4f1c...'
    minReplicas: 3                            // module enforces >= 3 in prod and zone-redundant environments
    ingress: 'internal'                       // public ingress requires an exemption
    keyVaultSecrets: [ 'Psp--ApiKey' ]        // wired via managed identity, never env plaintext
  }
}
~~~`,
  dia: r`flowchart LR
  PRE[Preventive: Azure Policy, PIM, deny settings] --> SUBS[Team subscriptions - autonomy inside guardrails]
  GP[Golden paths: AVM-based modules, pipelines, portal, vending] --> SUBS
  SUBS --> DET[Detective: Defender, policy compliance, cost anomalies]
  DET -->|findings with SLA| SUBS
  SUBS --> EXE[Time-bound exemptions + ADR]
  EXE -->|recurring exemptions| GP
  MET[DORA + secure score + DX metrics] --> GP`,
  pts: [r`Make the compliant path the easiest path.`, r`Preventive policy, golden paths, detective controls routed to owners.`, r`Policy as code with staged rollout.`, r`Time-bound exemptions; recurring exemptions signal a broken rule.`, r`Measure delivery, safety and developer experience together.`],
  ex: r`Replacing a weekly design board with AVM-based golden paths and policy as code cut new-service lead time from 5 weeks to 4 days while public-endpoint findings fell to near zero.`,
  fu: [r`How do you migrate 300 existing resources onto golden paths?`, r`Which decisions still require human review?`],
  pit: [r`Central approval for every change.`, r`Guardrails without a paved road.`, r`Not measuring governance's effect on delivery.`] },

{ id: 'q49', level: 'Principal', tags: ['zero-trust', 'security-architecture', 'conditional-access'],
  q: r`Design a Zero Trust security architecture for a bank on Azure: identity as the control plane, Conditional Access, privileged access, network segmentation, data protection, and detection — and how you would explain it to the board.`,
  a: r`**Principles**: verify explicitly, use least privilege, assume breach — applied to identities, devices, networks, applications and data.

**Identity as the primary control plane**
- Entra ID with **phishing-resistant MFA** (FIDO2/passkeys, Windows Hello for Business, certificate-based auth) for all staff; no legacy authentication.
- **Conditional Access**: require compliant or hybrid-joined devices for corporate apps, block risky sign-ins (ID Protection), location and session controls, token protection where supported; **Conditional Access for workload identities** for service principals.
- **Privileged access**: PIM for Entra and Azure roles, approval for production, privileged access workstations for admins, separate admin accounts, break-glass accounts monitored; access reviews.
- Workloads: managed identities and workload identity federation — no secrets.

**Network as a secondary control**
- Hub-spoke or Virtual WAN with Azure Firewall Premium (TLS inspection, IDPS), segmentation by trust zone, private endpoints for all PaaS, public network access disabled by policy; Front Door/WAF for internet entry; DDoS Network Protection for public IPs.
- Remote admin via **Bastion** or Entra-authenticated access (no RDP/SSH from the internet); Entra Private Access/Global Secure Access for user-to-app access instead of broad VPN.

**Applications and data**
- OAuth everywhere with audience and scope validation; secrets in Key Vault; supply-chain controls (signed images, admission policies).
- Data: classification with Purview, encryption with CMK where policy requires, Always Encrypted for the most sensitive columns, DLP for exfiltration paths, immutable audit logs.

**Assume breach — detection and response**
- Defender for Cloud (posture + workload protection), Defender XDR for endpoints/identities, **Sentinel** as SIEM/SOAR with playbooks; tabletop exercises and purple-team tests; blast-radius limits (subscription per workload, deployment stamps).

**For the board**: speak in risk, not products. "Most breaches start with stolen credentials; we made credentials far less useful (phishing-resistant MFA, no standing admin rights, no secrets in code), we limited how far an attacker can move (private networks, segmentation), and we detect and contain quickly (24/7 monitoring, automated response). Here are three metrics we report quarterly: % phishing-resistant MFA, standing privileged accounts, median time to contain."`,
  code: r`~~~json
// Conditional Access (Graph API body, excerpt): admins must use phishing-resistant MFA from compliant devices
{
  "displayName": "Admins - phishing-resistant MFA + compliant device",
  "state": "enabled",
  "conditions": {
    "users": { "includeRoles": ["62e90394-69f5-4237-9190-012177145e10"], "excludeUsers": ["<break-glass-1>", "<break-glass-2>"] },
    "applications": { "includeApplications": ["All"] },
    "clientAppTypes": ["all"]
  },
  "grantControls": {
    "operator": "AND",
    "builtInControls": ["compliantDevice"],
    "authenticationStrength": { "id": "00000000-0000-0000-0000-000000000004" }
  }
}
// IDs shown are the built-in Global Administrator role and the phishing-resistant authentication strength.
~~~`,
  dia: r`flowchart LR
  USER[Staff - passkeys] --> CA[Conditional Access: device, risk, strength]
  CA --> APPS[Apps via Entra / Global Secure Access]
  ADMIN[Admins - PAW] --> PIM[PIM: just-in-time, approval]
  PIM --> AZ[Azure subscriptions]
  APPS --> NET[Private endpoints, Firewall Premium, segmentation]
  NET --> DATA[(Data: Purview, CMK, Always Encrypted)]
  ALL[All signals] --> SEN[Sentinel + Defender XDR: detect and contain]`,
  pts: [r`Identity is the primary control: phishing-resistant MFA, Conditional Access, PIM.`, r`Workloads use managed identities and federation, not secrets.`, r`Network segmentation, private endpoints and controlled admin paths as secondary controls.`, r`Data classification, encryption and DLP.`, r`Assume breach: Defender, Sentinel, automated containment; report risk metrics to the board.`],
  ex: r`A bank's move to passkeys and PIM cut standing privileged accounts from 210 to 6; a later red-team exercise stalled because stolen passwords no longer granted access.`,
  fu: [r`How do you roll out phishing-resistant MFA to 20,000 staff without disrupting operations?`, r`What residual risks remain after this architecture?`],
  pit: [r`Treating the network perimeter as the main control.`, r`MFA by SMS for administrators.`, r`Break-glass accounts that nobody monitors.`] },

{ id: 'q50', level: 'Principal', tags: ['principles', 'summary'],
  q: r`Summarise the Azure architecture principles you would enforce as Principal Engineer for a financial-services platform.`,
  a: r`"My Azure principles fit on one page:

- **Subscriptions are boundaries**: landing zone hierarchy, subscription per workload and environment, vended with baselines; CDE isolated.
- **Identity first, no secrets**: Entra ID with phishing-resistant MFA and Conditional Access; PIM for privilege; managed identities and workload identity federation for every workload and pipeline; Entra-only auth on SQL; shared keys disabled.
- **Private by default**: private endpoints with central privatelink DNS, public network access denied by policy, explicit egress through NAT Gateway or Azure Firewall, Front Door + WAF at the edge.
- **Zone-redundant, statically stable**: zone-redundant SKUs chosen at creation, N-1 capacity, data-plane failover, warm standby where RTO demands, drills with Chaos Studio.
- **Correctness for money**: Azure SQL ledger, idempotency keys with unique constraints, outbox and inbox, sessions for ordered commands, reconciliation as the final detector.
- **Managed PaaS first**: Container Apps/App Service by default, AKS by exception; Azure Managed Redis not the retiring cache.
- **Everything as code**: Bicep/AVM or Terraform, deployment stacks, policy as code, images promoted by digest.
- **Observable and auditable**: OpenTelemetry to Application Insights, SLO alerts, Activity Log and Sentinel, immutable evidence.
- **Cost is a requirement**: tags, unit economics, reservations/savings plan, Hybrid Benefit.
- **Exit-aware**: containers, PostgreSQL/SQL standards, OpenTelemetry; tested exit plans for critical functions."`,
  code: r`~~~text
Boundaries    : ALZ management groups, subscription vending, CDE subscription
Identity      : passkeys + Conditional Access, PIM, managed identities, workload identity federation, Entra-only SQL
Network       : private endpoints + central DNS, deny public PaaS, NAT/Firewall egress, Front Door WAF
Resilience    : zone-redundant SKUs, N-1 capacity, failover groups, warm standby, Chaos Studio drills
Correctness   : Azure SQL ledger, Idempotency-Key + unique constraint, outbox/inbox, sessions, reconciliation
Platform      : Container Apps default, App Service, AKS by exception, Functions isolated worker
Delivery      : Bicep/AVM, deployment stacks, policy as code, build once promote by digest
Operations    : OTel -> App Insights, SLO alerts, Activity Log, Sentinel, immutable logs
Cost          : tags, unit cost, reservations, savings plan, Hybrid Benefit
Exit          : containers, standard data engines, OTel, tested exit plan
~~~`,
  pts: [r`Subscriptions as boundaries; identity first with no secrets.`, r`Private by default with central DNS.`, r`Zone-redundant and statically stable, with drills.`, r`Correctness patterns for money.`, r`Managed PaaS, everything as code, observable, cost-aware and exit-aware.`],
  ex: r`Encoding these principles in golden-path modules and policy initiatives meant 85% of new services were compliant on day one without a design review.`,
  fu: [r`Which principle would you enforce first in a legacy Azure estate?`],
  pit: [r`Principles without tooling to enforce them.`] }
],
cheat: r`### Hierarchy & identity
Tenant (Entra) → management groups → subscriptions (billing/quota/security boundary ≈ AWS account) → resource groups (lifecycle) · Entra roles = directory, Azure RBAC = resources (additive; scope MG → sub → RG → resource) · PIM for just-in-time privilege · Managed identity (user-assigned preferred) · workload identity federation for GitHub/AKS · DefaultAzureCredential locally, explicit credential in prod.

### Networking
Subnets are regional (span zones) · NSG stateful + priorities + deny; ASGs for role-based rules · UDR to Azure Firewall · NAT Gateway for explicit egress (SNAT: 64,512 ports per IP) · Private Endpoint + central privatelink DNS zones + DNS Private Resolver · Hub-spoke (non-transitive peering) or Virtual WAN · Front Door (global L7) / App Gateway (regional L7) / Load Balancer (L4) / Traffic Manager (DNS).

### Compute
| Choice | When |
|---|---|
| App Service | web APIs, slots + swap, Premium v3 zone-redundant |
| Functions | event glue; isolated worker (in-process ends Nov 2026); Flex Consumption/Premium; HTTP ~230 s |
| Container Apps | microservices/workers, KEDA, revisions, scale to zero |
| AKS | need Kubernetes APIs; CNI Overlay, workload identity, upgrades |

### Data
Azure SQL: GP / Business Critical (AG, readable secondary) / Hyperscale; EnableRetryOnFailure; failover groups with listeners, async RPO ≈ seconds · Managed Instance for SQL Server compatibility · Cosmos DB: partition key, RU, 5 consistency levels (Session default), transactional batch per partition, multi-region writes = LWW (not for balances) · Storage LRS/ZRS/GRS/GZRS, user delegation SAS, immutability for WORM · Azure Managed Redis (Azure Cache for Redis retiring).

### Messaging
Service Bus: peek-lock, DLQ (MaxDeliveryCount 10), duplicate detection (producer side), sessions = per-key FIFO, Premium for isolation; Geo-DR = metadata only · Event Grid: push notifications, retry 24 h, dead-letter · Event Hubs: partitions, TU = 1 MB/s in, consumer groups, checkpoint after processing, no DLQ, Capture.

### Security & governance
Key Vault RBAC model + purge protection + private endpoint; cache secrets · CMK, TDE, Always Encrypted (client-side) · Azure Policy: Deny / Audit / Modify / DeployIfNotExists; remediation needs the assignment identity's roles · Defender for Cloud + Sentinel · Conditional Access, passkeys.

### Resilience & cost
Zone-redundant SKUs set at creation · N-1 capacity · Front Door priority failover; human decision for DB promotion · Chaos Studio drills · Reservations, savings plan for compute, Azure Hybrid Benefit, Advisor, Spot.

### Say this
"Subscriptions are the blast-radius boundary." "Private endpoints fail on DNS, not networking." "Duplicate detection is not idempotency." "Multi-region writes mean last-writer-wins." "Static stability: survive without ARM." "Adopt each cloud's idioms; keep the code portable."`
});
})(String.raw);
