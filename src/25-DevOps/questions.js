(function (r) {
registerTopic('25-devops', {
related: ['26-cicd', '27-observability', '24-docker'],
questions: [
{ id: 'q1', level: 'Basic', tags: ['devops', 'calms', 'sre', 'culture'],
  q: r`What is DevOps beyond "tools and pipelines"? Explain CALMS and the Three Ways, and how DevOps, SRE and platform engineering relate.`,
  a: r`**DevOps** is a set of cultural and technical practices that shorten the path from idea to value in production **safely**, by making the same people accountable for building and running software and by automating the path between them. It addresses the old conflict where developers were rewarded for change and operations for stability.

**CALMS**
- **Culture**: shared ownership ("you build it, you run it"), blameless learning, collaboration over hand-offs.
- **Automation**: builds, tests, infrastructure, deployments, compliance evidence.
- **Lean**: small batches, limiting work in progress, removing waste and waiting time.
- **Measurement**: flow and stability metrics (DORA), SLOs, feedback from production.
- **Sharing**: knowledge, tooling, postmortems, inner source.

**The Three Ways** (The Phoenix Project / DevOps Handbook)
1. **Flow**: fast left-to-right flow from commit to production (small batches, CI, automated deployment, fewer hand-offs).
2. **Feedback**: fast right-to-left feedback (telemetry, alerting, peer review, testing in production safely).
3. **Continual learning and experimentation**: blameless postmortems, game days, time for improvement.

**Relationships**
- **SRE** (Site Reliability Engineering) is a concrete implementation of DevOps principles for reliability: SLOs, error budgets, toil limits, engineering approach to operations. "class SRE implements DevOps."
- **Platform engineering** builds an internal developer platform (golden paths, self-service infrastructure) so stream-aligned teams can do DevOps without each becoming infrastructure experts — reducing cognitive load.
- A "DevOps team" sitting between dev and ops as a new silo is an anti-pattern; a platform team that offers self-service is not.

**What interviewers want from a senior candidate**: the business outcome (lead time, reliability, cost of delay), the people and organisational design aspects, and evidence from measurement — not a tool list.`,
  code: r`~~~text
Value stream (before -> after) for a payments API change
Stage                    Before                         After
Code review              2 days (batching)              4 hours (small PRs)
Build + test             manual QA cycle 5 days         CI 12 min + automated tests
Change approval          weekly CAB                     automated policy + peer review evidence
Deployment               monthly window, 4 h outage     daily canary, zero downtime
Feedback                 user complaints                SLO dashboards + alerts in minutes
Lead time                ~6 weeks                       < 1 day
~~~`,
  dia: r`flowchart LR
  IDEA[Idea] --> CODE[Code + review]
  CODE --> CI[CI: build, test, scan]
  CI --> CD[Automated deploy - progressive]
  CD --> PROD[Production]
  PROD -->|telemetry, SLOs, incidents| FB[Feedback]
  FB --> IDEA
  PLAT[Platform team: golden paths] -.self-service.-> CI
  SRE[SRE practices: SLOs, error budgets] -.-> PROD`,
  pts: [r`DevOps = culture plus automation to shorten idea-to-production safely.`, r`CALMS: culture, automation, lean, measurement, sharing.`, r`Three Ways: flow, feedback, continual learning.`, r`SRE implements DevOps for reliability; platform engineering enables it at scale.`, r`A separate "DevOps team" silo is an anti-pattern.`],
  ex: r`A bank created a "DevOps team" that took tickets to write pipelines for others; lead time did not improve until it became a platform team offering self-service templates and teams owned their own production services.`,
  fu: [r`How would you know whether a DevOps initiative is working?`, r`Where do SRE and DevOps disagree in practice?`],
  pit: [r`Defining DevOps as a toolchain.`, r`Creating a new silo called the DevOps team.`, r`Ignoring organisational design and incentives.`] },

{ id: 'q2', level: 'Basic', tags: ['dora', 'metrics', 'delivery-performance'],
  q: r`Define the DORA metrics precisely, how you measure each from real systems, what good looks like, and how these metrics get misused.`,
  a: r`**The core DORA metrics** (from the DORA / Accelerate research)
| Metric | Definition | Typical data source |
|---|---|---|
| **Deployment frequency** | how often changes reach production | deployment pipeline/GitOps events |
| **Lead time for changes** | time from commit to running in production | commit timestamps + deployment events |
| **Change failure rate** | % of deployments causing a failure needing remediation (rollback, hotfix, incident) | deployments linked to incidents/rollbacks |
| **Failed deployment recovery time** (formerly "MTTR") | time to restore service after a failed change | incident tooling: start → mitigation |

Recent DORA reports also look at **reliability** (meeting SLOs) and **rework rate** (unplanned deployments to fix problems) as additional signals.

**Key research finding**: speed and stability are **not** a trade-off — high performers are both faster and more stable, because small, frequent, automated changes are easier to test, review, deploy and roll back.

**Measuring honestly**
- Automate collection from systems of record (Git, CI/CD, incident management) rather than surveys alone; define "deployment" and "failure" consistently across teams.
- Lead time: use the **commit time of each change** to deployment, not ticket creation (that measures product process, not delivery).
- Look at distributions (median, p90), not just averages; trend over time per team.

**Misuse to avoid**
- **Goodhart's law**: turning metrics into targets ("deploy 10 times a day") produces empty deployments or hidden failures.
- Comparing teams with different contexts (mainframe integration vs greenfield API) as a league table.
- Using metrics for individual performance reviews.
- Ignoring the "why": metrics indicate where to look (for example long lead time due to manual approvals), they are not the improvement itself.

**For regulated firms**: DORA metrics can coexist with control requirements — automated change evidence lets deployment frequency rise without weakening controls.`,
  code: r`~~~sql
-- Lead time for changes and deployment frequency per service (warehouse built from Git + CD events)
SELECT d.service,
       date_trunc('week', d.deployed_at)                                            AS week,
       count(DISTINCT d.deployment_id)                                               AS deployments,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY d.deployed_at - c.committed_at)   AS median_lead_time,
       avg(CASE WHEN i.incident_id IS NOT NULL OR d.rolled_back THEN 1.0 ELSE 0 END) AS change_failure_rate
FROM deployments d
JOIN deployment_commits dc ON dc.deployment_id = d.deployment_id
JOIN commits c             ON c.sha = dc.sha
LEFT JOIN incidents i      ON i.caused_by_deployment_id = d.deployment_id
WHERE d.environment = 'prod'
GROUP BY d.service, week
ORDER BY week DESC;
~~~`,
  dia: r`flowchart LR
  GIT[Git commits] --> WH[(Delivery metrics warehouse)]
  CD[CD / GitOps deploy events] --> WH
  INC[Incident tool: start, mitigated, cause] --> WH
  WH --> DF[Deployment frequency]
  WH --> LT[Lead time: commit to prod]
  WH --> CFR[Change failure rate]
  WH --> REC[Failed deployment recovery time]`,
  pts: [r`Four metrics: deployment frequency, lead time, change failure rate, failed deployment recovery time.`, r`Speed and stability improve together in high performers.`, r`Measure automatically from Git, CD and incident systems with consistent definitions.`, r`Use distributions and trends per team.`, r`Avoid targets, league tables and individual performance use.`],
  ex: r`A bank measured lead time from ticket creation and blamed engineering; measuring from commit showed delivery took 2 days while 5 weeks were spent in prioritisation and approvals.`,
  fu: [r`How do you define a "failed deployment" consistently?`, r`What would you do if deployment frequency rises but change failure rate rises too?`],
  pit: [r`Making DORA metrics individual targets.`, r`Measuring lead time from ticket creation.`, r`Comparing teams without context.`] },

{ id: 'q3', level: 'Basic', tags: ['iac', 'terraform', 'declarative', 'idempotency'],
  q: r`What is Infrastructure as Code? Compare declarative and imperative approaches, explain idempotency, and walk through how Terraform's plan/apply cycle, providers and state work.`,
  a: r`**Infrastructure as Code (IaC)**: infrastructure (networks, databases, clusters, IAM, DNS) is defined in version-controlled files and applied by tools, instead of manual console changes. Benefits: reproducibility, review and audit trail (pull requests), consistency across environments, faster recovery (rebuild from code), and policy checks before changes.

**Declarative vs imperative**
- **Declarative** (Terraform, CloudFormation, Bicep, Kubernetes manifests): describe the **desired end state**; the tool computes how to get there.
- **Imperative** (scripts, CLI calls): describe **steps**; re-running may fail or duplicate resources unless carefully written.
- **Idempotency**: applying the same definition repeatedly converges to the same state with no unintended changes — essential for safe automation and retries.

**Terraform mechanics**
- **Providers** (AWS, Azure, Google, Kubernetes, GitHub, Datadog...) translate resources into API calls.
- **Configuration** (HCL): resources, data sources, variables, outputs, modules.
- **State**: a mapping between configuration addresses and real resource IDs plus attributes. Terraform uses it to know what it manages, to compute diffs and dependencies.
- **Plan**: refresh real state (optionally), compare with configuration, produce an execution plan (create / update in place / destroy / **replace**).
- **Apply**: execute the plan in dependency order (a graph; parallel where possible), updating state.
- Commands: {{init}} (download providers/modules, configure backend), {{plan}}, {{apply}}, {{destroy}}, {{import}}, {{state}}.

**What to watch in a plan**: **"must be replaced"** on stateful resources (databases, volumes), destroy counts, changes to IAM and network rules, and unexpected diffs (drift).

**Terraform vs OpenTofu**: HashiCorp moved Terraform to the Business Source Licence in 2023; **OpenTofu** is the open-source fork under the Linux Foundation, largely compatible. Enterprises choose based on licensing, support and feature roadmap.`,
  code: r`~~~hcl
terraform {
  required_version = ">= 1.7"
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.60" } }
  backend "s3" { bucket = "bank-tfstate-prod", key = "payments/network.tfstate", region = "eu-west-1", use_lockfile = true }
}

provider "aws" { region = "eu-west-1" }

resource "aws_s3_bucket" "statements" {
  bucket = "bank-statements-prod-euw1"
  tags   = { owner = "payments", env = "prod", data_classification = "confidential" }
}

resource "aws_s3_bucket_public_access_block" "statements" {
  bucket                  = aws_s3_bucket.statements.id     # implicit dependency via reference
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
~~~
~~~bash
terraform init
terraform plan -out tfplan        # review: creates, updates, replacements, destroys
terraform apply tfplan            # applies exactly the reviewed plan
~~~`,
  dia: r`flowchart LR
  CODE[HCL configuration in Git] --> PLAN[terraform plan]
  STATE[(Remote state + lock)] --> PLAN
  CLOUD[Real infrastructure] -->|refresh| PLAN
  PLAN -->|reviewed in PR| APPLY[terraform apply]
  APPLY -->|provider API calls| CLOUD
  APPLY --> STATE`,
  pts: [r`IaC = versioned, reviewed, reproducible infrastructure definitions.`, r`Declarative describes desired state; idempotency makes re-runs safe.`, r`Terraform: providers, configuration, state, plan, apply in dependency order.`, r`Review plans for replacements, destroys, IAM and network changes.`, r`OpenTofu is the open-source fork after Terraform's licence change.`],
  ex: r`A team rebuilt a disaster-recovery region in 3 hours from Terraform code; the previous click-ops region had taken three weeks and differed from production in a dozen security settings.`,
  fu: [r`What happens if someone changes a resource in the console?`, r`Why apply a saved plan file rather than re-planning at apply time?`],
  pit: [r`Applying without reviewing replacements.`, r`Imperative scripts that are not idempotent.`, r`Mixing console changes with IaC.`] },

{ id: 'q4', level: 'Basic', tags: ['configuration', 'twelve-factor', 'environments', 'config-management'],
  q: r`How should configuration be managed across environments? Cover twelve-factor config, config versus secrets versus code, environment parity, and the difference between provisioning, configuration management and orchestration tools.`,
  a: r`**Twelve-factor config**: anything that varies between deployments (endpoints, credentials, feature toggles, resource sizes) lives **outside the code and the build artefact**, injected at deploy/run time. The **same artefact** runs in every environment; only configuration differs.

**Three categories**
| Category | Examples | Where |
|---|---|---|
| **Code** | business logic, defaults | repository, built into artefact |
| **Configuration** | URLs, timeouts, flags, scaling bounds | config files per environment in Git (Helm values, Kustomize overlays, app config service) |
| **Secrets** | passwords, API keys, certificates | secret managers / vaults; or eliminated via workload identity |

Rules: configuration is versioned and reviewed like code; secrets are never in Git in plaintext; configuration changes deploy through the pipeline (with validation) rather than manual edits; validate configuration at start-up ({{ValidateOnStart}} in .NET) so bad config fails fast.

**Environment parity**: dev, test, staging and production should differ in **scale and data**, not in **kind** — same database engine and version, same messaging technology, same identity model, same deployment mechanism. "We use SQLite locally and SQL Server in prod" or "staging has no WAF" hides defects until production.

**Tool taxonomy**
| Purpose | Examples | Notes |
|---|---|---|
| **Provisioning** (create infrastructure) | Terraform/OpenTofu, CloudFormation, Bicep, Pulumi, Crossplane | declarative cloud resources |
| **Configuration management** (configure servers) | Ansible, Chef, Puppet, Salt, DSC | mainly for VMs/on-prem; less needed with immutable images and containers |
| **Image building** | Packer, Dockerfiles | bake configuration into immutable images |
| **Orchestration / deployment** | Kubernetes, ECS, GitOps (Argo CD/Flux), CD pipelines | run and update applications |
| **Runtime config/flags** | AWS AppConfig, Azure App Configuration, LaunchDarkly, OpenFeature providers | change behaviour without redeploying |

**Modern default**: immutable artefacts (images), declarative provisioning, GitOps for deployment, a runtime config/feature-flag service for dynamic behaviour, and secrets from a vault.`,
  code: r`~~~csharp
// Same artefact everywhere; environment-specific values injected and validated at start-up
builder.Configuration
    .AddJsonFile("appsettings.json", optional: false)
    .AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.json", optional: true)
    .AddEnvironmentVariables();                                          // Psp__BaseUrl etc. from the platform

builder.Services.AddOptions<PspOptions>()
    .BindConfiguration("Psp")
    .ValidateDataAnnotations()
    .Validate(o => o.BaseUrl.Scheme == Uri.UriSchemeHttps, "PSP must use HTTPS")
    .ValidateOnStart();                                                  // bad config fails the deployment, not a customer request

public sealed class PspOptions
{
    [Required] public Uri BaseUrl { get; init; } = default!;
    [Range(1, 30)] public int TimeoutSeconds { get; init; } = 5;
}
~~~`,
  dia: r`flowchart LR
  CODE[Code - one artefact] --> ART[(Image by digest)]
  CFG[Config per env in Git] --> DEPLOY[Deployment]
  SEC[Secret manager / workload identity] --> DEPLOY
  ART --> DEPLOY
  DEPLOY --> DEV[Dev]
  DEPLOY --> STG[Staging]
  DEPLOY --> PRD[Prod]
  FLAGS[Runtime config / feature flags] -.no redeploy.-> PRD`,
  pts: [r`Configuration lives outside the artefact; one artefact for all environments.`, r`Separate code, configuration and secrets; version config, vault secrets.`, r`Validate configuration at start-up.`, r`Environments differ in scale and data, not kind.`, r`Provisioning, configuration management, image building, orchestration and runtime config are different tools.`],
  ex: r`A release failed in production only because staging used an in-memory broker while production used RabbitMQ; aligning staging to the same broker and version caught the next serialization issue before release.`,
  fu: [r`When is runtime configuration better than redeploying?`, r`How do you keep configuration drift between environments visible?`],
  pit: [r`Building separate artefacts per environment.`, r`Different technologies in staging and production.`, r`Secrets in configuration files in Git.`] },

{ id: 'q5', level: 'Basic', tags: ['release-strategies', 'blue-green', 'canary', 'feature-flags'],
  q: r`Compare release strategies — recreate, rolling, blue-green, canary, shadow, and feature flags — and explain the difference between deploying and releasing.`,
  a: r`**Deploy vs release**: **deployment** puts new code into production; **release** exposes the behaviour to users. Decoupling them (feature flags, dark launches) lets you deploy continuously with low risk and release when the business is ready — and turn features off without redeploying.

| Strategy | How | Pros | Cons |
|---|---|---|---|
| **Recreate** | stop old, start new | simple; no version overlap | downtime |
| **Rolling** | replace instances gradually | no extra capacity, no downtime | both versions live at once; rollback is another rollout; all users hit new code eventually without judgement |
| **Blue-green** | full new environment, switch traffic at once | instant switch and rollback, full pre-release testing | double capacity during switch; database/schema must suit both; switch is all-or-nothing |
| **Canary** | small % of traffic to new version, increase on healthy metrics | limits blast radius, data-driven decisions | needs traffic splitting and good metrics; longer rollouts |
| **Shadow (mirroring)** | copy production traffic to new version, discard responses | tests with real traffic, no user impact | side effects must be suppressed (no double payments!); cost |
| **Feature flags** | code paths toggled at runtime per user/segment | release decoupled from deploy, kill switches, experiments | flag debt; testing combinations; flag service becomes a dependency |
| **A/B testing** | flags/routing for experiments with statistical analysis | product learning | not a safety mechanism by itself |

**Choosing**
- Most services: rolling or canary with automated analysis (q22) plus feature flags for risky features.
- Blue-green for systems needing full validation before switch or very fast rollback (and where double capacity is affordable).
- Shadow for high-risk rewrites (a new pricing engine) where responses can be compared offline — never for side-effecting operations without stubbing.

**Constraint common to all**: during overlap, **both versions run** — database schema, message formats and APIs must be backward and forward compatible (expand/contract, q12).`,
  code: r`~~~csharp
// Feature flag (OpenFeature .NET SDK): deploy dark, release to a segment, kill instantly if needed
var client = Api.Instance.GetClient();
var ctx = EvaluationContext.Builder()
    .Set("merchantId", merchantId).Set("region", region).Build();

if (await client.GetBooleanValueAsync("instant-payouts", defaultValue: false, ctx))
    return await _instantPayouts.ExecuteAsync(request, ct);      // new path, released to selected merchants
return await _standardPayouts.ExecuteAsync(request, ct);         // existing path remains the default
~~~`,
  dia: r`flowchart LR
  subgraph Canary
    LB1[Router] -->|95| V1[v1]
    LB1 -->|5| V2[v2 + metric analysis]
  end
  subgraph BlueGreen
    LB2[Router] -->|100 then switch| BLUE[Blue v1]
    LB2 -.after tests.-> GREEN[Green v2]
  end
  subgraph Flags
    APP[Deployed v2] -->|flag on for segment| NEWF[New behaviour]
    APP -->|flag off| OLDF[Old behaviour]
  end`,
  pts: [r`Deploying is not releasing; feature flags decouple them.`, r`Rolling is cheap but unjudged; canary limits blast radius with metrics.`, r`Blue-green gives instant switch and rollback at double capacity.`, r`Shadow traffic tests safely only without side effects.`, r`All overlap strategies need backward-compatible schemas and contracts.`],
  ex: r`A payments team released instant payouts behind a flag to 2% of merchants after deploying the code a week earlier; when a PSP limit was hit, they turned the flag off in seconds without a rollback.`,
  fu: [r`Why is shadow traffic dangerous for payment endpoints?`, r`How do you clean up feature flags?`],
  pit: [r`Treating deployment as release.`, r`Shadowing side-effecting requests.`, r`Ignoring version overlap in schema design.`] },

{ id: 'q6', level: 'Basic', tags: ['sre', 'sli', 'slo', 'error-budget'],
  q: r`Define SLIs, SLOs, SLAs and error budgets with a concrete payments example. How do error budgets change the conversation between product and engineering?`,
  a: r`**Definitions**
- **SLI** (indicator): a measured ratio of good events to valid events — for example "authorisation requests that return a non-5xx response in under 500 ms" / "all authorisation requests".
- **SLO** (objective): the target for an SLI over a window — "99.95% of authorisation requests succeed within 500 ms over 28 days".
- **SLA** (agreement): a contractual promise with consequences (credits, penalties), usually **looser** than the internal SLO so you have room to react.
- **Error budget**: 100% − SLO. At 99.95% over 28 days: 0.05% of requests may fail. At 10 million requests/day × 28 = 280 million requests → **140,000** failed or slow requests allowed; or, for a time-based SLO, 0.0005 × 28 × 24 × 60 ≈ **20 minutes** of full outage.

**Choosing good SLIs**: measure what users feel, at the closest point to them (load balancer or client), per critical user journey (authorise payment, view balance, initiate transfer). Avoid CPU or "pod up" as SLIs.

**Choosing SLO levels**: not 100% (impossible and infinitely expensive; also downstream dependencies cap you). Base it on user needs and historical performance; each extra "nine" costs significantly more (redundancy, multi-region, processes). Different journeys get different SLOs (card authorisation 99.95%, monthly statement generation 99.5%).

**How error budgets change the conversation**
- Reliability becomes a **shared, quantified budget** rather than a debate: if the budget is healthy, teams ship faster and take risks (experiments, bigger changes); if it is exhausted, the **error budget policy** shifts focus to reliability work (freeze risky launches, fix top causes) until it recovers.
- Product and engineering agree in advance, so decisions in the moment are not emotional.
- It discourages over-engineering: if you are at 99.99% against a 99.9% need, you may be spending too much on reliability.

**Alerting**: alert on **burn rate** (how fast the budget is being consumed), with multi-window rules — page on fast burns (2% of monthly budget in an hour), ticket on slow burns.`,
  code: r`~~~yaml
# SLO definition (OpenSLO-style) for card authorisation
apiVersion: openslo/v1
kind: SLO
metadata: { name: card-authorisation-availability }
spec:
  service: payments-api
  indicator:
    metadata: { name: auth-good-ratio }
    spec:
      ratioMetric:
        good:  { metricSource: { type: Prometheus, spec: { query: 'sum(rate(http_server_request_duration_seconds_bucket{route="/v1/authorisations",le="0.5",http_response_status_code!~"5.."}[5m]))' } } }
        total: { metricSource: { type: Prometheus, spec: { query: 'sum(rate(http_server_request_duration_seconds_count{route="/v1/authorisations"}[5m]))' } } }
  timeWindow: [ { duration: 28d, isRolling: true } ]
  budgetingMethod: Occurrences
  objectives: [ { displayName: "99.95% under 500 ms", target: 0.9995 } ]
~~~`,
  dia: r`flowchart LR
  SLI[SLI: good / valid requests] --> SLO[SLO 99.95 percent over 28 days]
  SLO --> EB[Error budget 0.05 percent]
  EB -->|healthy| SHIP[Ship faster, experiment]
  EB -->|exhausted| POL[Error budget policy: reliability work, freeze risky launches]
  SLO -.looser.-> SLA[SLA with customers]
  EB --> BURN[Burn-rate alerts]`,
  pts: [r`SLI = good/valid ratio; SLO = target over a window; SLA = contract, looser than SLO.`, r`Error budget = 100% − SLO, expressed in requests or minutes.`, r`SLIs measure user journeys at the edge, not infrastructure.`, r`Error budget policies pre-agree what happens when budgets run out.`, r`Alert on burn rate, not raw error spikes.`],
  ex: r`A card platform's error budget policy froze non-critical launches for two weeks after a bad month; the team fixed its top two incident causes and the next quarter shipped faster than before.`,
  fu: [r`How do you set an SLO for a service with no history?`, r`What do you do when a dependency's SLO is lower than yours?`],
  pit: [r`100% SLOs.`, r`Using CPU or uptime of pods as SLIs.`, r`SLAs equal to internal SLOs, leaving no margin.`] },

{ id: 'q7', level: 'Intermediate', tags: ['terraform-state', 'backends', 'locking', 'security'],
  q: r`Terraform state in depth: remote backends and locking, what sensitive data state contains, how to split state, and how teams collaborate safely on the same infrastructure.`,
  a: r`**Why state matters**: it maps configuration addresses ({{aws_db_instance.ledger}}) to real resource IDs, caches attributes, and records dependencies. Lose or corrupt it and Terraform no longer knows what it manages — it may try to create duplicates or fail.

**Remote backends**: S3 (with locking via S3 lock files in recent versions or a DynamoDB table in older setups), Azure Storage (blob lease locking), GCS, Terraform Cloud/Enterprise, or other HTTP backends. Requirements:
- **Locking** so two applies cannot run concurrently and corrupt state.
- **Versioning** of the state object (S3 versioning / blob versioning) for recovery.
- **Encryption at rest** with KMS and strict access control.

**State contains secrets**: database passwords (if Terraform generated or set them), private keys, tokens and connection strings appear **in plaintext** in state, even when variables are marked {{sensitive}} (that only hides them from CLI output). Therefore: restrict read access to state as tightly as to the secrets themselves; prefer generating secrets in the secret manager and referencing them (or use managed master passwords like RDS-managed secrets), use ephemeral values/write-only arguments where supported in newer versions, and never commit state to Git.

**Splitting state** (by blast radius and lifecycle)
- Per environment (dev/staging/prod) — never share state across environments.
- Per layer/component: network, shared services, data stores, application infrastructure; per team/service.
- Small states: faster plans, smaller blast radius, fewer lock conflicts; cost: cross-state references via outputs/remote state data sources or SSM/parameter lookups.

**Collaboration**
- All applies run through **CI/CD** (Atlantis, Terraform Cloud, Spacelift, GitHub Actions) — plans posted to pull requests, applies after approval, using a pipeline identity with least privilege; humans do not apply from laptops to production.
- Pin Terraform and provider versions ({{.terraform.lock.hcl}} committed).
- Handle stuck locks deliberately ({{terraform force-unlock}} only after confirming no apply is running).`,
  code: r`~~~hcl
# State layout: one state per environment and component; locking + versioning + KMS
terraform {
  backend "s3" {
    bucket       = "bank-tfstate-prod"
    key          = "payments/data-stores/terraform.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    kms_key_id   = "arn:aws:kms:eu-west-1:111122223333:key/9f1c..."
    use_lockfile = true          # S3-native locking (older setups: dynamodb_table = "tf-locks")
  }
}

# Avoid putting the DB password in state: let RDS manage it in Secrets Manager
resource "aws_db_instance" "ledger" {
  identifier                  = "ledger-prod"
  engine                      = "postgres"
  instance_class              = "db.r7g.xlarge"
  allocated_storage           = 500
  manage_master_user_password = true            # secret lives in Secrets Manager, not in TF state
  deletion_protection         = true
  storage_encrypted           = true
}
~~~`,
  dia: r`flowchart LR
  PR[Pull request] --> CI[CI runner: plan with pipeline identity]
  CI -->|acquire lock| ST[(State bucket: versioned, KMS, locked)]
  CI -->|plan posted| PR
  PR -->|approved| AP[Apply in CI]
  AP --> ST
  AP --> CLOUD[Cloud APIs]
  NET[network.tfstate] -.outputs.-> APPST[app.tfstate]`,
  pts: [r`State maps config to real resources; protect it like a database.`, r`Remote backend with locking, versioning, encryption and strict access.`, r`State holds secrets in plaintext; minimise and restrict.`, r`Split state by environment and component for blast radius.`, r`Apply only from CI with reviewed plans and pinned versions.`],
  ex: r`Two engineers ran apply from laptops against a local state copy; one deleted the other's newly created subnets. Moving to a locked remote backend with CI-only applies ended it.`,
  fu: [r`How would you recover from a corrupted state file?`, r`How do you reference outputs from another state safely?`],
  pit: [r`State in Git or on laptops.`, r`One giant state for all environments.`, r`Assuming sensitive variables are encrypted in state.`] },

{ id: 'q8', level: 'Intermediate', tags: ['terraform-modules', 'environments', 'workspaces', 'terragrunt'],
  q: r`Structure Terraform for many environments and teams: modules and versioning, workspaces versus directory-per-environment versus Terragrunt, and avoiding copy-paste drift between environments.`,
  a: r`**Modules**: reusable building blocks (a "service network", "postgres database with backups and alarms", "ECS service"). Good modules are opinionated, encode company standards (encryption, tagging, logging), expose few inputs, and have outputs that compose.
- **Versioning**: publish modules with semantic versions (private registry or Git tags); environments pin versions; upgrades via PRs (Renovate). Breaking changes bump major versions with migration notes (often {{moved}} blocks).
- Avoid modules that wrap a single resource with every argument exposed — that adds indirection without value.

**Environment strategies**
| Approach | How | Pros | Cons |
|---|---|---|---|
| **Workspaces** (CLI) | same config, separate state per workspace | quick for identical environments | hidden differences via {{terraform.workspace}} conditionals; easy to apply to the wrong workspace; same backend credentials across envs |
| **Directory per environment** | {{envs/dev}}, {{envs/prod}} call the same modules with different inputs | explicit, separate backends/credentials per env, clear reviews | some duplication of root module wiring |
| **Terragrunt** (or similar wrappers) | DRY root configuration, dependency handling between stacks, generated backends | less boilerplate across many stacks | extra tool and abstraction |
| **Terraform Cloud/Stacks, Spacelift** | platform-managed workspaces and stacks | governance, RBAC, run history | vendor/cost |

**Common enterprise choice**: versioned modules + directory per environment and component (separate state and credentials per account/subscription), optionally Terragrunt for many accounts; environment differences expressed **only through variables** (sizes, counts, CIDRs), not divergent code.

**Preventing drift between environments**: same module versions promoted dev → staging → prod (like application artefacts), automated checks that prod is not on an older module version for long, and code review rules that flag environment-specific conditionals.`,
  code: r`~~~text
infra/
  modules/                         # or a separate repo / private registry with versions
    postgres/  (v3.2.0)
    service-network/ (v1.8.1)
  live/
    prod/
      eu-west-1/
        network/     main.tf -> module "net" { source = "app.terraform.io/bank/service-network/aws" version = "1.8.1" }
        payments-db/ main.tf -> module "db"  { source = ".../postgres/aws" version = "3.2.0" instance_class = "db.r7g.xlarge" }
    staging/
      eu-west-1/
        payments-db/ main.tf -> module "db"  { version = "3.3.0" instance_class = "db.r7g.large" }   # new version tested here first
~~~
~~~hcl
module "payments_db" {
  source         = "app.terraform.io/bank/postgres/aws"
  version        = "3.2.0"
  name           = "payments-prod"
  instance_class = "db.r7g.xlarge"
  multi_az       = true
  backup_days    = 35
  tags           = local.tags
}
~~~`,
  dia: r`flowchart LR
  MOD[Versioned modules: postgres 3.3.0] --> DEV[live/dev - module 3.3.0]
  DEV -->|promote version| STG[live/staging - 3.3.0]
  STG -->|promote version| PRD[live/prod - 3.2.0 to 3.3.0 via PR]
  DEV --> S1[(dev state - dev account)]
  STG --> S2[(staging state)]
  PRD --> S3[(prod state - prod account, prod credentials)]`,
  pts: [r`Opinionated, versioned modules encode standards.`, r`Workspaces hide differences and share credentials; directories per environment are explicit.`, r`Terragrunt reduces boilerplate for many stacks.`, r`Express environment differences only through variables.`, r`Promote module versions across environments like artefacts.`],
  ex: r`A team using workspaces ran apply in the prod workspace thinking it was dev; separate directories with prod-only credentials in a protected pipeline made that mistake impossible.`,
  fu: [r`How do you roll out a breaking module change to 60 consumers?`, r`When are workspaces acceptable?`],
  pit: [r`Workspaces as the only environment separation for production.`, r`Copy-pasted environments diverging in code.`, r`Unversioned module references to main branches.`] },

{ id: 'q9', level: 'Intermediate', tags: ['drift', 'import', 'refactoring', 'moved-blocks'],
  q: r`Handle infrastructure drift and refactoring in Terraform: detecting drift, deciding whether to revert or adopt changes, importing existing resources, and refactoring safely with moved and removed blocks.`,
  a: r`**Drift**: real infrastructure differs from code/state — console hotfixes, automation outside Terraform (auto-scaling changing counts, other tools adding tags), or provider defaults changing.

**Detection**
- Scheduled {{terraform plan -detailed-exitcode}} per stack (exit code 2 = changes) in CI; alert the owning team; dashboards per stack.
- Cloud-native config history (AWS Config, Azure Activity Log/Resource Graph) to see who changed what.
- Platforms (Terraform Cloud health assessments, Spacelift drift detection) automate it.

**Deciding what to do**
- **Revert** (apply code) if the change was unauthorised or unsafe.
- **Adopt** (update code to match) if the change was a legitimate emergency fix — then the code becomes the source of truth again.
- **Ignore deliberately** for attributes managed elsewhere ({{ignore_changes = [desired_count]}} in a lifecycle block for autoscaled counts) — documented, minimal.
- Prevent recurrence: read-only console access in production, break-glass with alerts, policies.

**Importing existing resources** (brownfield)
- {{import}} blocks (Terraform 1.5+) in code: declarative, reviewable, plan shows the import; {{terraform plan -generate-config-out}} drafts configuration for imported resources (review and clean it up).
- Import one component at a time and confirm a **no-change plan** before moving on.

**Refactoring without destroy/create**
- Renaming a resource or moving it into a module changes its address — without guidance Terraform plans destroy + create (data loss for databases). Use **{{moved}}** blocks to record the address change; plans then show "moved" with no infrastructure change.
- **{{removed}}** blocks (1.7+) stop managing a resource without destroying it (hand-over to another stack).
- Splitting states: {{terraform state mv}} across states, or removed in one + import in the other.
- Always review plans for unexpected replacements; protect critical resources with {{prevent_destroy}} and cloud deletion protection.`,
  code: r`~~~hcl
# Brownfield adoption: import an existing bucket created in the console
import {
  to = aws_s3_bucket.reports
  id = "bank-reports-legacy"
}
resource "aws_s3_bucket" "reports" {
  bucket = "bank-reports-legacy"
  tags   = { owner = "finance", env = "prod" }
}

# Refactor: resource moved into a module without destroying the database
moved {
  from = aws_db_instance.ledger
  to   = module.ledger_db.aws_db_instance.this
}

# Hand over a resource to another stack without deleting it
removed {
  from = aws_route53_zone.legacy
  lifecycle { destroy = false }
}

resource "aws_ecs_service" "api" {
  # ... desired_count managed by Application Auto Scaling, not Terraform
  lifecycle { ignore_changes = [desired_count] }
}
~~~
~~~bash
terraform plan -detailed-exitcode -lock=false -input=false; rc=$?
[ $rc -eq 2 ] && echo "DRIFT detected in payments/data-stores" && exit 1
~~~`,
  dia: r`flowchart TD
  SCH[Nightly plan per stack] -->|exit code 2| DRIFT[Drift detected]
  DRIFT --> WHO[Who changed it? Config history]
  WHO --> D{Legitimate?}
  D -->|no| REVERT[Apply code - revert]
  D -->|yes emergency fix| ADOPT[Update code, no-change plan]
  D -->|managed elsewhere| IGN[ignore_changes - documented]
  REF[Refactor addresses] --> MOVED[moved / removed blocks - no destroy]`,
  pts: [r`Detect drift with scheduled plans and config history.`, r`Revert unauthorised changes, adopt legitimate ones, ignore only deliberately.`, r`Import blocks and generated config for brownfield adoption; aim for no-change plans.`, r`moved and removed blocks refactor without destroying resources.`, r`Prevent drift with read-only consoles and break-glass alerts.`],
  ex: r`A refactor moving an RDS instance into a module planned "1 to destroy, 1 to add"; the reviewer caught it and a moved block turned it into a zero-change plan.`,
  fu: [r`How do you migrate resources between two state files?`, r`When is ignore_changes a smell?`],
  pit: [r`Refactoring addresses without moved blocks.`, r`Blanket ignore_changes hiding real drift.`, r`Importing many resources at once without verifying no-change plans.`] },

{ id: 'q10', level: 'Intermediate', tags: ['secrets', 'vault', 'rotation', 'oidc'],
  q: r`Design secrets management for delivery pipelines and running services: secret stores, dynamic secrets, OIDC federation for CI, rotation without downtime, and keeping secrets out of logs, state and artefacts.`,
  a: r`**Principles**: minimise the number of secrets (identity federation instead of keys), centralise the rest in a vault with audit, keep them short-lived, rotate automatically, and keep them out of code, images, logs and IaC state.

**Eliminate secrets first**
- **CI/CD to cloud**: OIDC federation (GitHub Actions/GitLab/Azure DevOps → AWS IAM roles, Azure workload identity federation, GCP Workload Identity Federation) — short-lived tokens scoped by repository, branch and environment.
- **Workloads**: IAM roles/managed identities (IRSA, Pod Identity, Azure managed identity) for cloud services; IAM/Entra database authentication where supported.

**Secret stores** for what remains: AWS Secrets Manager, Azure Key Vault, GCP Secret Manager, HashiCorp Vault. Features: access policies per service, audit logs, versioning, rotation hooks, replication across regions.

**Dynamic secrets** (Vault database secrets engine, cloud IAM auth): credentials created on demand per workload with a **lease** (for example 1 hour) and revoked automatically — a leaked credential expires quickly and is attributable.

**Rotation without downtime**
- **Dual-credential pattern**: create the new credential, make both valid, update consumers (config reload or rolling restart), verify, revoke the old one.
- Applications read secrets at runtime with caching and refresh (not only at start-up), or the platform triggers rolling restarts on change.
- Rotation schedules by risk (30-90 days, or continuous with dynamic secrets); event-driven rotation on suspected leaks.

**Keeping secrets out of places**
- **Code/Git**: secret scanning (pre-commit hooks, server-side push protection), {{.gitignore}} for local files, no secrets in sample configs.
- **Images**: BuildKit secret mounts (see Docker q18).
- **IaC state**: let services generate and own secrets (RDS-managed passwords), pass references rather than values.
- **Logs and pipeline output**: masking in CI (a safety net only), redaction in application logging, never echoing environment variables.
- **Tickets/chat**: no secrets in issue trackers or messages; use one-time share tools when unavoidable.`,
  code: r`~~~yaml
# GitHub Actions: no stored cloud keys - OIDC role assumption scoped to repo + environment
permissions: { id-token: write, contents: read }
jobs:
  deploy:
    environment: prod
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with: { role-to-assume: "arn:aws:iam::444455556666:role/gha-payments-deploy", aws-region: eu-west-1 }
      - run: aws secretsmanager describe-secret --secret-id prod/payments/psp --query 'RotationEnabled'
~~~
~~~csharp
// Runtime: read secrets with caching and periodic refresh so rotation needs no redeploy
builder.Configuration.AddSecretsManager(configurator: o =>
{
    o.SecretFilter = s => s.Name.StartsWith("prod/payments/");
    o.PollingInterval = TimeSpan.FromMinutes(10);          // picks up rotated versions
    o.KeyGenerator = (_, name) => name.Replace("prod/payments/", "").Replace("/", ":");
});
~~~`,
  dia: r`flowchart LR
  CI[CI job] -->|OIDC token| STS[Cloud STS / Entra]
  STS -->|short-lived creds| DEPLOY[Deploy]
  POD[Workload] -->|workload identity| CLOUD[Cloud services - no secret]
  POD -->|lease 1h| VAULT[Vault dynamic DB creds]
  VAULT --> DB[(Database)]
  SM[Secrets Manager - rotation dual credential] --> POD
  SCAN[Secret scanning: Git, images, logs] -.prevents leaks.-> CI`,
  pts: [r`Eliminate secrets with OIDC for CI and workload identity for services.`, r`Centralise remaining secrets in a vault with audit and per-service access.`, r`Dynamic, leased credentials limit leak impact.`, r`Rotate with dual credentials and runtime refresh.`, r`Keep secrets out of Git, images, state, logs and tickets.`],
  ex: r`A bank replaced 400 long-lived CI secrets with OIDC roles and Vault dynamic database credentials; a later leaked log line contained a credential that had already expired.`,
  fu: [r`How do you rotate a third-party API key that supports only one active key?`, r`What does CI log masking fail to protect against?`],
  pit: [r`Long-lived cloud keys in CI variables.`, r`Rotation that requires coordinated downtime.`, r`Relying on log masking as protection.`] },

{ id: 'q11', level: 'Intermediate', tags: ['feature-flags', 'openfeature', 'flag-debt', 'kill-switch'],
  q: r`Use feature flags safely at scale: flag types, targeting and evaluation, OpenFeature, performance and failure modes of flag services, testing, and preventing flag debt.`,
  a: r`**Flag types (different lifecycles)**
| Type | Purpose | Lifetime |
|---|---|---|
| **Release** | hide incomplete or risky features; gradual rollout | days to weeks — then remove |
| **Ops / kill switch** | turn off expensive or failing functionality quickly | long-lived, documented |
| **Experiment** | A/B tests | duration of experiment |
| **Permission / entitlement** | features per customer tier | long-lived (arguably configuration) |

**Targeting and evaluation**: rules by user, merchant, region, percentage (consistent hashing so a user stays in the same bucket), environment. Evaluate **locally in the SDK** from a cached rule set streamed from the flag service — no network call per evaluation.

**OpenFeature** (CNCF): a vendor-neutral API and SDKs (.NET, JavaScript/TypeScript for Angular/React) with providers for LaunchDarkly, Flagsmith, Unleash, flagd, cloud config services — swap vendors without changing call sites; hooks for logging/metrics.

**Failure modes**
- Flag service unavailable: SDKs must fall back to the last cached rules, then to **safe defaults in code** (usually "off" for new features, "on" for kill switches meaning "feature enabled").
- Start-up dependency: do not block application start on the flag service for long.
- Inconsistent evaluation between frontend and backend: evaluate server-side for security-relevant decisions; the SPA may receive evaluated flags from the backend.
- Flags controlling security or money paths need audit trails and change approval like code.

**Testing**: test both flag states for release flags in CI; avoid combinatorial explosion by keeping flags independent and short-lived; integration tests with a local provider (flagd/in-memory).

**Preventing flag debt**
- Every release flag gets an owner, a creation date and an expiry/removal ticket at creation.
- Dashboards of stale flags (fully rolled out for N days, or not evaluated recently); linters/code references to find usages.
- Remove the flag and the dead code path as part of the "done" definition.`,
  code: r`~~~csharp
// .NET: OpenFeature with a provider; safe default if the flag service is down
await Api.Instance.SetProviderAsync(new FlagdProvider(new FlagdConfig { Host = "flagd.platform", Port = 8013, Cache = "lru" }));
var flags = Api.Instance.GetClient("payments-api");

var ctx = EvaluationContext.Builder().SetTargetingKey(merchantId).Set("country", country).Build();
var useNewFraudModel = await flags.GetBooleanValueAsync("fraud-model-v2", false, ctx);   // default off
var cbEnabled = await flags.GetBooleanValueAsync("chargeback-automation", true, ctx);     // kill switch default on
~~~
~~~typescript
// Angular/React: same API via OpenFeature web SDK; never trust client flags for authorisation decisions
import { OpenFeature } from '@openfeature/web-sdk';
await OpenFeature.setProviderAndWait(new FlagdWebProvider({ host: 'flags.bank.example', port: 443, tls: true }));
const showNewDashboard = OpenFeature.getClient().getBooleanValue('new-dashboard', false);
~~~`,
  dia: r`flowchart LR
  ADMIN[Flag console - audited changes] --> FS[Flag service]
  FS -->|stream rules| SDK1[.NET SDK - local evaluation, cached]
  FS -->|stream rules| SDK2[SPA SDK]
  SDK1 -->|service down| DEF[Last cached rules, then safe defaults]
  REG[Flag registry: owner, expiry] --> STALE[Stale flag report]
  STALE --> CLEAN[Remove flag + dead code]`,
  pts: [r`Release, ops, experiment and permission flags have different lifecycles.`, r`Evaluate locally from cached rules; consistent percentage bucketing.`, r`OpenFeature avoids vendor lock-in across .NET and SPAs.`, r`Plan for flag service failure with cached rules and safe defaults.`, r`Owner, expiry and removal for every release flag.`],
  ex: r`A neobank found 600 flags in its codebase, 70% fully rolled out for months; an expiry policy and stale-flag dashboard removed 400 and simplified testing significantly.`,
  fu: [r`What default should a kill switch have when the flag service is unreachable?`, r`How do you audit flag changes for regulated features?`],
  pit: [r`Network calls per flag evaluation.`, r`Permanent release flags.`, r`Trusting client-side flags for authorisation.`] },

{ id: 'q12', level: 'Intermediate', tags: ['database-migrations', 'expand-contract', 'ef-core', 'zero-downtime'],
  q: r`Deploy database schema changes with zero downtime using expand/contract: walk through renaming a column used by a running .NET service, how EF Core migrations fit, long-running migrations, and rollback.`,
  a: r`**Why**: during rolling, canary or blue-green deployments, old and new application versions run **simultaneously** against the same database. A schema change that breaks the old version causes errors during the rollout and makes rollback impossible.

**Expand/contract (parallel change) — renaming {{customer_name}} to {{full_name}}**
1. **Expand**: add {{full_name}} (nullable); deploy. Old code ignores it.
2. **Dual write**: release app version that writes both columns, reads old (or new with fallback). Deploy everywhere.
3. **Backfill**: copy existing data in **batches** (small transactions, throttled) to avoid long locks and log growth; verify counts.
4. **Switch reads**: app reads {{full_name}}, still writes both (so rollback to step 2 stays safe).
5. **Stop writing old**: app writes only {{full_name}}.
6. **Contract**: after a safe period (and when no old version can be deployed), drop {{customer_name}}.
Each step is independently deployable and reversible.

**EF Core fit**
- Generate migrations normally, but **split** them along these steps; review generated SQL ({{dotnet ef migrations script --idempotent}}) — EF may generate a rename as drop+add on some providers, or a table rebuild.
- Apply migrations as a **separate pipeline step** (migration bundle or SQL script) before deploying the new app version — not at application start-up (concurrency across replicas, permissions, timeouts).
- The application's DB user should not have DDL rights in production; the migration job uses a separate identity.

**Risky operations**: adding NOT NULL columns with defaults on huge tables (engine-dependent — PostgreSQL 11+ is fast for constant defaults; SQL Server online options vary), index creation (use {{CONCURRENTLY}} in PostgreSQL / {{ONLINE = ON}} in SQL Server Enterprise/Azure SQL), changing column types, adding foreign keys (validate separately). Use online schema tools where needed and set lock timeouts so migrations fail fast instead of blocking traffic.

**Rollback**: schema changes are rolled **forward**; expand steps are additive, so rolling back the app is safe. Avoid destructive down-migrations in production; restore from backups only for disasters.`,
  code: r`~~~csharp
// Migration 1 (expand): additive and safe for the old version
public partial class AddFullName : Migration
{
    protected override void Up(MigrationBuilder mb) =>
        mb.AddColumn<string>(name: "full_name", table: "customers", maxLength: 200, nullable: true);
    protected override void Down(MigrationBuilder mb) => mb.DropColumn(name: "full_name", table: "customers");
}

// App version 2: dual write, read with fallback
public void Rename(Customer c, string name) { c.CustomerName = name; c.FullName = name; }
public string DisplayName(Customer c) => c.FullName ?? c.CustomerName;
~~~
~~~sql
-- Backfill in batches (PostgreSQL), run by the migration job, throttled
SET lock_timeout = '2s';
WITH batch AS (
  SELECT id FROM customers WHERE full_name IS NULL ORDER BY id LIMIT 5000 FOR UPDATE SKIP LOCKED
)
UPDATE customers c SET full_name = c.customer_name FROM batch WHERE c.id = batch.id;
-- repeat until 0 rows; later release: CREATE INDEX CONCURRENTLY ix_customers_full_name ON customers(full_name);
~~~`,
  dia: r`flowchart LR
  E[1 Expand: add full_name] --> DW[2 Dual write]
  DW --> BF[3 Backfill in batches]
  BF --> SR[4 Read new, write both]
  SR --> SW[5 Write new only]
  SW --> C[6 Contract: drop customer_name]
  SR -.app rollback safe.-> DW`,
  pts: [r`Old and new versions share the database during deployments.`, r`Expand, dual write, backfill, switch reads, stop old writes, contract.`, r`Run EF Core migrations as a separate step with a separate identity; review SQL.`, r`Use online index builds, batching and lock timeouts for big tables.`, r`Roll schema forward; keep expand steps additive so app rollback is safe.`],
  ex: r`A team renamed a column in one migration during a rolling deploy; old pods threw errors for 12 minutes. The expand/contract playbook made the next rename a zero-error change over three releases.`,
  fu: [r`Why not run EF Core migrations at application start-up?`, r`How do you handle a NOT NULL column on a 2-billion-row table?`],
  pit: [r`Renames and drops in the same release as code changes.`, r`Unbatched backfills locking tables.`, r`Destructive down-migrations as a rollback plan.`] },

{ id: 'q13', level: 'Intermediate', tags: ['devsecops', 'sast', 'sca', 'shift-left'],
  q: r`Implement DevSecOps "shift left" for .NET and Angular/React services: SAST, SCA, secret scanning, IaC scanning, container scanning, DAST — where each runs, how to gate, and how to keep developers from ignoring the results.`,
  a: r`**Controls and placement**
| Control | Finds | Where | Gate |
|---|---|---|---|
| **Secret scanning** | keys, tokens, passwords in code/history | pre-commit hooks + server-side **push protection** | block push |
| **SAST** (CodeQL, Semgrep, SonarQube, Roslyn analyzers) | injection, insecure deserialization, weak crypto, SSRF patterns | PR checks | block new high-severity findings |
| **SCA** (dependency scanning: Dependabot, Snyk, OWASP Dependency-Check, {{dotnet list package --vulnerable}}, npm audit) | known-vulnerable NuGet/npm packages, licences | PR + scheduled | block new criticals with fixes; licence policy |
| **IaC scanning** (Checkov, tfsec/Trivy, KICS, cfn-guard) | public buckets, open security groups, missing encryption | PR on Terraform/Bicep/Helm | block policy violations |
| **Container scanning** | OS/runtime CVEs in images | build + registry + runtime | block fixable criticals (see Docker q44) |
| **DAST** (OWASP ZAP, Burp) | runtime issues: headers, auth flaws, injection on running app | against staging/ephemeral environments | report; block on high for internet-facing |
| **API security tests** | broken object-level auth (BOLA), mass assignment | integration tests per endpoint | block |

**Gating philosophy**: **block on new, high-confidence, high-severity findings** in changed code (diff-aware); report the backlog separately with SLAs. Gating on the entire historical backlog makes every build red and teaches people to bypass checks.

**Keeping developers engaged**
- Findings appear **in the PR** with fix guidance (autofix suggestions, Dependabot PRs), not in a separate portal weeks later.
- Tune rules to the stack to cut false positives; suppressions in code with justification and review.
- Fast checks (seconds to a few minutes) in PRs; slower deep scans nightly.
- Security champions in teams; secure templates (CSP headers, parameterised queries, antiforgery, auth defaults) so the easy path is safe.
- Metrics: mean time to remediate, new-vs-fixed trends per team — not raw finding counts.

**Frontend specifics**: npm supply-chain risk (lock files, {{npm ci}}, provenance, private registry proxies), CSP and Trusted Types, dependency bloat review, source maps not public in production.`,
  code: r`~~~yaml
# GitHub Actions (excerpt): fast PR security checks
jobs:
  security:
    runs-on: ubuntu-latest
    permissions: { contents: read, security-events: write }
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with: { languages: "csharp,javascript-typescript", queries: security-extended }
      - run: dotnet build Payments.sln -c Release
      - uses: github/codeql-action/analyze@v3
      - run: dotnet list package --vulnerable --include-transitive 2>&1 | tee vuln.txt && ! grep -q -E "High|Critical" vuln.txt
      - run: npm ci --prefix web && npm audit --prefix web --audit-level=high
      - uses: bridgecrewio/checkov-action@v12
        with: { directory: infra/, framework: terraform, soft_fail: false }
~~~
~~~xml
<!-- Directory.Build.props: Roslyn security analyzers and NuGet audit as build errors -->
<PropertyGroup>
  <AnalysisMode>Recommended</AnalysisMode>
  <NuGetAudit>true</NuGetAudit>
  <NuGetAuditMode>all</NuGetAuditMode>
  <WarningsAsErrors>$(WarningsAsErrors);NU1903;NU1904;CA2100;CA3075;CA5350;CA5351</WarningsAsErrors>
</PropertyGroup>
~~~`,
  dia: r`flowchart LR
  DEVL[Developer: pre-commit secret scan, IDE analyzers] --> PR[Pull request]
  PR --> SAST[SAST - diff aware]
  PR --> SCA[SCA + licences]
  PR --> IAC[IaC scan]
  PR --> SEC[Secret scan push protection]
  PR --> BUILD[Build + image scan]
  BUILD --> STG[Ephemeral env: DAST + API auth tests]
  STG --> PROD[Prod: runtime scanning]
  NIGHT[Nightly deep scans] --> BACKLOG[Backlog with SLAs]`,
  pts: [r`Secret scanning, SAST, SCA, IaC, container scanning and DAST each catch different issues.`, r`Run fast checks in PRs; deep scans nightly.`, r`Gate on new high-confidence, high-severity findings; track backlog with SLAs.`, r`Put findings and fixes in the PR; tune rules; use secure templates.`, r`Measure remediation time, not finding counts.`],
  ex: r`A bank gated every build on its 4,000-finding SAST backlog; teams added blanket suppressions. Switching to diff-aware gating plus backlog SLAs cut new high findings by 70% in a quarter.`,
  fu: [r`How do you handle a critical CVE in a transitive dependency with no fix?`, r`What can DAST find that SAST cannot?`],
  pit: [r`Blocking on historical backlogs.`, r`Security findings delivered outside the developer workflow.`, r`Treating npm audit noise as reason to disable SCA.`] },

{ id: 'q14', level: 'Intermediate', tags: ['policy-as-code', 'opa', 'conftest', 'sentinel'],
  q: r`Apply policy as code to infrastructure and deployments: OPA/Rego with Conftest, Sentinel, Checkov, Kyverno — where policies run (plan time, admission, runtime), how to write testable policies, and how to manage exceptions.`,
  a: r`**What policy as code means**: rules ("no public S3 buckets", "all resources tagged with owner and cost-centre", "prod databases have deletion protection", "only EU regions", "container images from our registry, signed") written as code, versioned, tested and enforced automatically — replacing manual review checklists and spreadsheets.

**Where policies run (defence in depth)**
| Stage | Tooling | Example |
|---|---|---|
| **IDE / pre-commit** | Checkov, tflint, Conftest | fast feedback before PR |
| **Plan time (CI)** | Conftest/OPA on {{terraform show -json}}, Sentinel (Terraform Cloud/Enterprise), Checkov, cloud policy engines | block a plan creating an unencrypted volume |
| **Deploy time (admission)** | Kyverno, Gatekeeper (OPA), ValidatingAdmissionPolicy | block privileged pods, unsigned images |
| **Cloud control plane** | AWS SCPs/Config rules, Azure Policy, GCP Org Policy | deny resource creation outside allowed regions regardless of tool |
| **Runtime / continuous** | AWS Config, Azure Policy compliance, Security Hub, Defender | detect drift and console-created violations |

Plan-time checks give the best developer experience (feedback in the PR); cloud-level preventive controls are the backstop that catches everything (console, other tools).

**Writing good policies**
- Evaluate the **plan JSON** (resource changes after), not just HCL text — catches values from modules and variables.
- Clear messages: what is wrong, why, how to fix, link to the standard.
- **Unit tests** for policies (OPA {{opa test}}, Conftest verify, Sentinel test cases) with passing and failing fixtures; policies live in a repo with review and versioning.
- Severity levels: advisory (warn) vs mandatory (deny); new policies start advisory.

**Exceptions**: explicit, time-bound and reviewed — exception files or annotations (resource ID, policy ID, reason, owner, expiry) checked by the policy engine; dashboards of active exceptions; expired exceptions fail builds.`,
  code: r`~~~text
# policy/terraform/rds.rego - Conftest/OPA against terraform show -json output
package terraform.rds

import rego.v1

deny contains msg if {
  rc := input.resource_changes[_]
  rc.type == "aws_db_instance"
  rc.change.actions[_] in {"create", "update"}
  not rc.change.after.deletion_protection
  not exempt(rc.address)
  msg := sprintf("%s: production databases must enable deletion_protection (standard DB-04)", [rc.address])
}

deny contains msg if {
  rc := input.resource_changes[_]
  rc.type == "aws_db_instance"
  not rc.change.after.storage_encrypted
  msg := sprintf("%s: storage_encrypted must be true (standard DB-01)", [rc.address])
}

exempt(addr) if {
  some e in data.exceptions
  e.address == addr
  time.parse_rfc3339_ns(e.expires) > time.now_ns()
}
~~~
~~~bash
terraform plan -out tfplan && terraform show -json tfplan > plan.json
conftest test plan.json --policy policy/terraform --data exceptions.json
opa test policy/ -v                       # policy unit tests with fixtures
~~~`,
  dia: r`flowchart LR
  IDE[IDE / pre-commit] --> PRC[PR: plan JSON + Conftest / Sentinel]
  PRC --> ADM[Admission: Kyverno / Gatekeeper]
  ADM --> CLOUD[Cloud preventive: SCP, Azure Policy, Org Policy]
  CLOUD --> CONT[Continuous: Config rules, compliance dashboards]
  EXC[Time-bound exceptions in Git] --> PRC
  EXC --> ADM`,
  pts: [r`Policies as versioned, tested code replace manual checklists.`, r`Layer checks: pre-commit, plan time, admission, cloud preventive, continuous.`, r`Evaluate plan JSON; write clear messages; unit-test policies.`, r`Start advisory, then enforce.`, r`Time-bound, reviewed exceptions enforced by the engine.`],
  ex: r`A bank encoded 40 infrastructure standards in Conftest policies on Terraform plans; architecture review time per change fell from days to minutes, and console-created violations were caught by Azure Policy as a backstop.`,
  fu: [r`Why evaluate plan JSON instead of HCL source?`, r`How do you roll out a new mandatory policy without breaking teams?`],
  pit: [r`Policies with cryptic messages.`, r`Only plan-time checks with no cloud backstop.`, r`Permanent, untracked exceptions.`] },

{ id: 'q15', level: 'Intermediate', tags: ['incident-management', 'roles', 'communication', 'postmortem'],
  q: r`Run incident management: severity levels, roles (incident commander, comms, operations), the lifecycle from detection to postmortem, communication cadence, and what "mitigate first" means.`,
  a: r`**Severity levels** (example)
| Sev | Definition | Response |
|---|---|---|
| **SEV1** | major customer impact (payments failing, data breach suspected), regulatory exposure | page immediately, IC assigned, exec + regulatory comms considered, status page |
| **SEV2** | significant degradation or partial outage, workaround exists | page on-call, IC, internal comms |
| **SEV3** | minor impact, single feature or internal tools | business hours |
Define them by **customer and business impact**, not by which system broke.

**Roles**
- **Incident Commander (IC)**: owns coordination and decisions; does not debug. Assigns tasks, sets priorities, decides on mitigations (rollback, failover), declares resolution.
- **Operations / technical leads**: investigate and execute mitigations.
- **Communications lead**: status page, internal updates, customer support, executives; regular cadence (for example every 30 minutes for SEV1) even when there is nothing new.
- **Scribe**: timeline of events, decisions and actions (evidence for the postmortem and regulators).
- Subject-matter experts pulled in as needed; others stay out of the incident channel to reduce noise.

**Lifecycle**
1. **Detect** (alerts on SLO burn, customer reports) → 2. **Triage and declare** severity → 3. **Mitigate** → 4. **Resolve** → 5. **Postmortem** → 6. **Follow-up actions** tracked to completion.

**Mitigate first**: restore service before finding root cause — roll back the recent deployment, disable a feature flag, fail over, scale up, block abusive traffic, shed load. Root-cause analysis happens after customers are safe. Rollback is the default when an incident follows a change.

**Communication**: one incident channel, one bridge, a single source of truth (incident doc); honest external updates with impact and next update time; avoid speculation about cause.

**Postmortems**: blameless, within days, focused on contributing factors and systemic fixes; action items with owners and dates; shared widely.

**Regulated firms**: classification against regulatory criteria (major ICT incident under DORA, PSD2 major incident reporting, payment scheme rules), and notification timelines decided early in the incident.`,
  code: r`~~~text
INCIDENT 2026-10-11-03  SEV1  "Card authorisations failing in EU"
IC: A. Rossi    Ops lead: K. Chen    Comms: M. Okafor    Scribe: J. Patel
Impact: ~18% of EU authorisations declined with 5xx since 09:12 UTC
09:14  SLO burn alert (14x) paged on-call
09:16  SEV1 declared; channel #inc-2026-10-11-03; status page "investigating"
09:21  Correlated with payments-api deploy 09:05 (canary skipped by manual override)
09:23  DECISION (IC): roll back to previous digest
09:29  Rollback complete; error rate back to baseline
09:30  Comms: status page "monitoring"; next update 10:00
09:50  Resolved; regulatory classification assessment requested from Compliance
Follow-ups: postmortem due 2026-10-14; remove manual canary override path (owner: platform)
~~~`,
  dia: r`flowchart LR
  D[Detect: SLO burn alert] --> T[Triage + declare severity]
  T --> IC[IC assigns roles]
  IC --> M[Mitigate first: rollback, flag off, failover]
  M --> R[Resolve + verify]
  R --> PM[Blameless postmortem]
  PM --> A[Action items tracked]
  IC --> COM[Comms cadence: status page, execs, regulators]`,
  pts: [r`Severity by customer and business impact.`, r`Roles: IC coordinates, ops investigate, comms communicates, scribe records.`, r`Mitigate first; rollback is the default after a change.`, r`Regular communication cadence with a single source of truth.`, r`Blameless postmortems with tracked actions; regulatory classification early.`],
  ex: r`An outage dragged on for 2 hours because the most senior engineer acted as IC while also debugging; separating roles cut the next SEV1's time to mitigation to 14 minutes.`,
  fu: [r`When should the IC decide to fail over rather than keep debugging?`, r`How do you handle an incident that spans three teams?`],
  pit: [r`IC also doing the debugging.`, r`Searching for root cause before mitigating.`, r`Silence in communications when there is no news.`] },

{ id: 'q16', level: 'Intermediate', tags: ['on-call', 'alerting', 'toil', 'sustainability'],
  q: r`Design a sustainable on-call practice: rotations and handovers, what should page someone, alert quality metrics, runbooks, compensation and well-being, and how to reduce pages over time.`,
  a: r`**Ownership**: teams that build services run them ("you build it, you run it"); platform teams run platforms. On-call is part of the job design, not a punishment.

**Rotation design**
- At least **5-8 people** per rotation to keep load humane (one week in six or more); follow-the-sun for global teams to avoid night pages.
- Primary and secondary; clear escalation paths to SMEs and management.
- **Handover** notes: ongoing issues, recent changes, known risks.
- Compensation/time off in lieu per local regulation and policy; protected recovery after night incidents.

**What should page**
- Only **actionable, urgent, user-impacting** conditions: SLO fast burn, complete outages of critical journeys, security events requiring immediate action, imminent capacity exhaustion (disk will fill in 1 hour).
- Everything else becomes a **ticket** (slow burns, single-instance failures handled by auto-healing, warnings).
- Each page must have a **runbook**: what it means, impact, diagnosis steps, mitigations, escalation.

**Alert quality metrics**
- Pages per shift (target, for example, fewer than 2 per on-call day), percentage of pages that were actionable, false-positive rate, time to acknowledge, night-time pages, repeat alerts.
- Review alerts weekly: delete, tune, or automate any alert that fired without action.

**Reducing pages**: fix recurring root causes (error budget policy), automate remediation for known issues (auto-restart, auto-scale, self-healing jobs), better health checks, safer deployments (canaries), and SLO-based alerting instead of threshold sprawl.

**Well-being and fairness**: track load per person, avoid hero culture, ensure new joiners shadow before carrying the pager, and make on-call load visible to management as an engineering cost (toil).`,
  code: r`~~~yaml
# Prometheus alert with runbook and clear routing: page only on fast burn
groups:
  - name: payments-slo
    rules:
      - alert: AuthorisationErrorBudgetFastBurn
        expr: |
          (1 - (sum(rate(authorisation_good_total[5m])) / sum(rate(authorisation_total[5m])))) > 14.4 * 0.0005
          and
          (1 - (sum(rate(authorisation_good_total[1h])) / sum(rate(authorisation_total[1h])))) > 14.4 * 0.0005
        for: 2m
        labels: { severity: page, team: payments }
        annotations:
          summary: "Authorisation SLO burning 14x - budget gone in ~2 days"
          runbook_url: "https://runbooks.internal/payments/authorisation-fast-burn"
      - alert: AuthorisationErrorBudgetSlowBurn
        expr: (1 - (sum(rate(authorisation_good_total[6h])) / sum(rate(authorisation_total[6h])))) > 3 * 0.0005
        for: 30m
        labels: { severity: ticket, team: payments }
~~~`,
  dia: r`flowchart LR
  SIG[Signals] --> Q{Actionable, urgent, user impact?}
  Q -->|yes| PAGE[Page + runbook]
  Q -->|no| TKT[Ticket / dashboard]
  PAGE --> REV[Weekly alert review]
  TKT --> REV
  REV --> FIX[Delete, tune, automate, fix root cause]
  FIX --> SIG`,
  pts: [r`Teams run what they build; rotations of 5-8 people with handovers.`, r`Page only for actionable, urgent, user-impacting conditions with runbooks.`, r`Measure pages per shift, actionability and night pages.`, r`Review alerts weekly; automate or delete noise; fix recurring causes.`, r`Compensate, protect recovery, track load, avoid heroes.`],
  ex: r`A payments team averaged 9 pages per night from CPU and pod-restart alerts; switching to SLO burn alerts plus auto-healing brought it under 1 per week without missing a customer-impacting incident.`,
  fu: [r`How do you decide whether an alert should page or ticket?`, r`How do you onboard engineers to on-call safely?`],
  pit: [r`Paging on CPU thresholds.`, r`Alerts without runbooks.`, r`Rotations of two or three people.`] },

{ id: 'q17', level: 'Intermediate', tags: ['immutable-infrastructure', 'packer', 'ansible', 'golden-images'],
  q: r`Mutable versus immutable infrastructure: how do configuration management tools (Ansible, Chef, Puppet) compare with golden images (Packer) and containers, and how do you patch VM fleets in an immutable model?`,
  a: r`**Mutable infrastructure**: long-lived servers changed in place — patch, reconfigure, deploy new versions onto the same machines (often via Ansible/Chef/Puppet or manual SSH). Problems: **configuration drift** ("snowflake servers"), unreproducible state, failed partial updates, hard rollbacks, and audit difficulty.

**Immutable infrastructure**: never modify running servers; build a new image (VM image or container) with the change and replace instances. Benefits: every instance is identical and known, rollback = redeploy the previous image, changes are tested before reaching production, drift is eliminated by construction.

**Tools**
| Tool | Role |
|---|---|
| **Packer** | build VM images (AMIs, Azure images) from a template: base OS + hardening + agents + app (or runtime) |
| **Ansible/Chef/Puppet** | configure machines; in immutable models used **inside** image builds (Packer provisioner), not on running servers |
| **Containers** | the application-level immutable artefact; the host OS image is still managed |
| **Auto Scaling groups / scale sets** | roll new images through instance refresh with health checks |

**Patching an immutable VM fleet**
1. Pipeline builds a new golden image weekly (or on critical CVE) from the latest OS patches, runs CIS hardening and tests (Inspec/Goss), scans, signs/tags it.
2. Image promoted dev → staging → prod.
3. **Instance refresh** in the ASG/scale set (or node pool upgrade in Kubernetes) replaces instances gradually with health checks and minimum healthy percentage.
4. Old images kept for rollback, then deprecated.
Evidence for auditors: image build records, scan results and rollout history show when each patch reached production.

**When configuration management still fits**: on-premises fleets, appliances, network devices, legacy servers that cannot be replaced easily, and bootstrapping; also as the provisioning step in image builds.`,
  code: r`~~~hcl
# Packer: hardened golden image for VM-based workloads (built weekly by the pipeline)
source "amazon-ebs" "base" {
  region        = "eu-west-1"
  instance_type = "m7g.large"
  source_ami_filter {
    filters     = { name = "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*" }
    owners      = ["099720109477"]
    most_recent = true
  }
  ssh_username = "ubuntu"
  ami_name     = "bank-base-noble-{{timestamp}}"
  tags         = { os = "ubuntu-24.04", hardening = "cis-l1", built_by = "packer-pipeline" }
}

build {
  sources = ["source.amazon-ebs.base"]
  provisioner "ansible" { playbook_file = "playbooks/harden-cis.yml" }        # config management inside the build
  provisioner "shell"   { inline = ["sudo apt-get -y upgrade", "sudo /opt/tests/goss validate"] }
}
~~~
~~~bash
aws autoscaling start-instance-refresh --auto-scaling-group-name reporting-asg \
  --preferences '{"MinHealthyPercentage": 90, "InstanceWarmup": 120}'
~~~`,
  dia: r`flowchart LR
  SRC[Base OS + patches] --> PK[Packer build: Ansible hardening, tests, scan]
  PK --> IMG[(Golden image vN)]
  IMG --> STG[Staging ASG refresh]
  STG --> PRD[Prod ASG instance refresh - health checked]
  PRD -.rollback = previous image.-> IMG
  MUT[Mutable: SSH / in-place config] -.drift, snowflakes.-> X[Avoid]`,
  pts: [r`Mutable servers drift; immutable instances are replaced, not changed.`, r`Packer builds golden images; config management runs inside builds.`, r`Patch by rebuilding images and rolling instance refreshes.`, r`Rollback = previous image; build records are audit evidence.`, r`Config management remains useful for on-prem, appliances and legacy.`],
  ex: r`A bank's VM estate had 300 servers with subtly different configurations; moving to weekly Packer images and instance refreshes cut patch rollout time from six weeks to four days and passed a CIS audit cleanly.`,
  fu: [r`How do you handle stateful VMs in an immutable model?`, r`How quickly could you roll out an emergency kernel patch?`],
  pit: [r`SSH-ing into production to hotfix.`, r`Running Ansible against live servers as the main change mechanism.`, r`No tests in the image pipeline.`] },

{ id: 'q18', level: 'Intermediate', tags: ['ephemeral-environments', 'preview', 'environment-strategy', 'cost'],
  q: r`Design an environment strategy: how many long-lived environments you need, ephemeral preview environments per pull request, test data, shared dependencies, and controlling cost.`,
  a: r`**Long-lived environments (keep few)**
- **Production**.
- **Staging/pre-production**: production-like (same topology, versions, security controls, scaled down) for final validation, performance tests and release rehearsals.
- **Development/integration**: shared environment for integration with other teams' services.
More long-lived environments mean more drift, more cost and more "it works in UAT2" confusion. Each must be built from the same IaC and deployment pipeline.

**Ephemeral preview environments**
- Created automatically per pull request (namespace + app deployment + needed dependencies), torn down on merge/close or after a TTL.
- Uses: reviewers and product owners click a URL to see the change, E2E tests and DAST run against an isolated environment, frontend changes (Angular/React) preview against real APIs.
- Implementation: Kubernetes namespaces via GitOps ApplicationSets (pull request generator), or platform features (App Service slots, Container Apps revisions, Vercel/Netlify-style previews for SPAs).

**Dependencies in previews**
- **Containerised** lightweight dependencies per preview (database seeded with synthetic data).
- **Shared** heavyweight services (identity provider, message broker) in the dev environment, with isolation by naming/tenancy.
- **Mocks/sandboxes** for third parties (PSP sandbox endpoints, WireMock).
- Service virtualisation for systems too expensive to replicate (mainframe).

**Test data**: synthetic data generators producing realistic distributions; masked/subsetted production data only with privacy approval and controls (never raw PII/PANs in lower environments); reset per run.

**Cost control**: TTLs and auto-teardown, scale to zero when idle, small instance sizes, spot capacity, schedules for dev/staging (off nights and weekends), cost visibility per environment and per PR, quotas per team.`,
  code: r`~~~yaml
# Argo CD ApplicationSet: one preview environment per open pull request, auto-deleted on close
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata: { name: payments-previews, namespace: argocd }
spec:
  generators:
    - pullRequest:
        github: { owner: bank, repo: payments-api, labels: [preview] }
        requeueAfterSeconds: 120
  template:
    metadata: { name: "payments-pr-{{number}}" }
    spec:
      project: previews
      source:
        repoURL: https://github.com/bank/payments-api.git
        targetRevision: "{{head_sha}}"
        path: deploy/preview
        helm:
          parameters:
            - { name: image.tag, value: "sha-{{head_short_sha}}" }
            - { name: ingress.host, value: "pr-{{number}}.preview.bank.example" }
            - { name: db.seed, value: synthetic }
      destination: { server: https://kubernetes.default.svc, namespace: "preview-pr-{{number}}" }
      syncPolicy: { automated: { prune: true }, syncOptions: [CreateNamespace=true] }
~~~`,
  dia: r`flowchart LR
  PR[Pull request opened] --> GEN[ApplicationSet PR generator]
  GEN --> NS[Namespace preview-pr-123: app + seeded DB]
  NS --> URL[pr-123.preview URL for review, E2E, DAST]
  NS --> SHARED[Shared dev services: IdP, broker]
  NS --> MOCK[PSP sandbox / WireMock]
  CLOSE[PR merged or closed] --> DEL[Teardown + cost report]`,
  pts: [r`Keep long-lived environments few and identical in kind to production.`, r`Ephemeral per-PR previews for review, E2E and DAST.`, r`Mix per-preview containers, shared services and mocks for dependencies.`, r`Synthetic or properly masked test data; never raw PII in lower environments.`, r`TTLs, scale to zero, schedules and per-environment cost visibility.`],
  ex: r`A bank retired four long-lived UAT environments in favour of per-PR previews plus one staging; environment costs fell 45% and "works in UAT3" defects disappeared.`,
  fu: [r`How do you handle database migrations in preview environments?`, r`What would you never put in a preview environment?`],
  pit: [r`Many long-lived environments that drift.`, r`Production data copied into dev environments.`, r`Previews that never get torn down.`] },

{ id: 'q19', level: 'Senior', tags: ['terraform-at-scale', 'atlantis', 'blast-radius', 'ci'],
  q: r`Run Terraform at enterprise scale: hundreds of stacks across many accounts, plan/apply automation (Atlantis, Terraform Cloud, Spacelift, GitHub Actions), dependency ordering between stacks, provider pinning, performance and blast-radius control.`,
  a: r`**Structure**: many small stacks (per account/subscription, environment, component), versioned modules, and a clear dependency graph (network → shared services → data → applications).

**Automation patterns**
- **PR-driven workflow**: on PR, CI runs {{init}}/{{validate}}/{{plan}} for affected stacks only (path-based detection) and posts plan summaries; policy checks run on plan JSON; after approval, **apply runs from CI** (Atlantis {{atlantis apply}}, Terraform Cloud runs, Spacelift stacks, or GitHub Actions with environments).
- **Locking at the PR level** (Atlantis) prevents two PRs applying to the same stack in conflicting order.
- **Apply after merge** vs **apply before merge** — both exist; apply-before-merge (Atlantis default) keeps main equal to reality if applies fail; apply-after-merge needs automatic retry and alerting.
- Credentials: per-stack roles via OIDC; prod apply identity can only be assumed from protected workflows.

**Dependencies between stacks**: consume upstream outputs via remote state data sources, parameter stores, or data lookups by tags; orchestrate ordering with Terragrunt dependencies or platform stack dependencies; avoid tight coupling (consumers should tolerate upstream changes, versioned outputs).

**Performance**: big states mean slow refreshes (thousands of API calls), rate limiting by cloud APIs, long locks. Split stacks; use {{-refresh=false}} only knowingly; targeted plans ({{-target}}) only for emergencies — never as a routine workflow.

**Version management**: pin Terraform/OpenTofu versions per stack ({{required_version}}), commit {{.terraform.lock.hcl}}, pin provider ranges ({{~> 5.60}}), upgrade providers deliberately via automated PRs with plan diffs reviewed across stacks (provider upgrades can cause unexpected diffs).

**Blast-radius controls**
- Small stacks; prod separated by account and credentials.
- **Plan review highlighting destroys and replacements** (automated comment: "3 to destroy" in red); policy denies destroying protected resource types without an explicit override label.
- {{prevent_destroy}} on critical resources plus cloud deletion protection.
- Staged rollout of shared module changes (canary stacks first).`,
  code: r`~~~yaml
# atlantis.yaml (excerpt): autoplan only affected projects; apply requires approval + mergeable
version: 3
projects:
  - name: prod-euw1-network
    dir: live/prod/eu-west-1/network
    workflow: prod
    autoplan: { when_modified: ["*.tf", "../../../../modules/service-network/**/*.tf"] }
    apply_requirements: [approved, mergeable]
  - name: prod-euw1-payments-db
    dir: live/prod/eu-west-1/payments-db
    workflow: prod
    apply_requirements: [approved, mergeable]
workflows:
  prod:
    plan:
      steps:
        - init
        - plan
        - run: terraform show -json $PLANFILE > plan.json && conftest test plan.json --policy /policies
        - run: jq '[.resource_changes[] | select(.change.actions | index("delete"))] | length' plan.json | xargs -I{} sh -c 'test {} -eq 0 || echo "WARNING: {} resources will be destroyed"'
~~~`,
  dia: r`flowchart LR
  PR[PR changes module or stack] --> DET[Detect affected stacks]
  DET --> PLAN[Plan per stack + policy checks + destroy warnings]
  PLAN --> REV[Review + approval]
  REV --> APPLY[Apply from CI with per-stack OIDC role]
  APPLY --> NET[network stack]
  NET -->|outputs| DATA[data stack]
  DATA -->|outputs| APP[app stack]`,
  pts: [r`Many small stacks with a clear dependency graph.`, r`PR-driven plans and CI applies with PR-level locking.`, r`Consume upstream outputs loosely; order with stack dependencies.`, r`Pin Terraform and providers; upgrade via reviewed PRs.`, r`Highlight destroys, protect critical resources, canary shared module changes.`],
  ex: r`A provider upgrade produced unexpected tag diffs across 300 stacks; because upgrades ran as automated PRs with plan summaries, the team spotted it in canary stacks before touching production.`,
  fu: [r`Apply before or after merge, and why?`, r`When is -target acceptable?`],
  pit: [r`Routine use of -target.`, r`Applies from laptops.`, r`Unpinned provider versions.`] },

{ id: 'q20', level: 'Senior', tags: ['terraform-failures', 'partial-apply', 'state-recovery'],
  q: r`What goes wrong with Terraform in production and how do you recover: partial applies, stuck locks, state corruption or loss, provider bugs, resources deleted outside Terraform, and destructive plans?`,
  a: r`**Partial apply**: an apply fails midway (API error, timeout, quota). Terraform records what succeeded in state; re-running plan shows the remaining changes. Usually: fix the cause, re-plan, re-apply. Dangerous when the failure left a half-configured resource (for example a replaced resource created but dependents not updated) — read the plan carefully before re-applying.

**Stuck locks**: a crashed CI job leaves the state locked. Confirm no apply is running (CI history), then {{terraform force-unlock <id>}}. Never force-unlock blindly — concurrent applies corrupt state.

**State corruption or loss**
- Remote backends with **versioning** let you restore a previous state version — then reconcile with reality via plan (resources created after that version need import).
- Total loss: rebuild state by **importing** resources (import blocks, generated config) stack by stack. This is why small stacks and tags with stack ownership help.
- Back up state as part of DR; restrict who can write it.

**Resources deleted or changed outside Terraform**: plan shows them to be recreated or modified; decide whether recreation is safe (a deleted database is not "recreate"; restore from backup, then import).

**Provider bugs / API changes**: a provider upgrade misreads an attribute and plans replacement of resources. Pin versions, test upgrades in non-prod, and if needed use {{ignore_changes}} in a lifecycle block temporarily or roll back the provider version.

**Destructive plans — prevention**
- Policy that fails plans destroying protected types (databases, KMS keys, DNS zones, buckets with data) unless an override label is applied by an authorised approver.
- {{prevent_destroy}} lifecycle + cloud-level deletion protection (RDS, Azure resource locks, S3 Object Lock where relevant) as independent safety nets.
- Plan summaries in PRs with destroy counts prominently displayed.

**State surgery** ({{terraform state mv/rm}}, {{import}}) is sometimes necessary: do it via reviewed PRs where possible ({{moved}}, {{removed}}, {{import}} blocks), take a state backup first, and verify with a no-change plan after.

**Incident discipline**: treat IaC failures in production like any incident — IC, timeline, communicate, postmortem.`,
  code: r`~~~bash
# Recover from a corrupted state: restore the previous object version, then reconcile
aws s3api list-object-versions --bucket bank-tfstate-prod --prefix payments/data-stores/terraform.tfstate --max-items 5
aws s3api get-object --bucket bank-tfstate-prod --key payments/data-stores/terraform.tfstate \
  --version-id 3HL4kqtJlcpXroDTDmJ.rmSpXd3dIbrHY terraform.tfstate.restored
terraform state push terraform.tfstate.restored          # after taking a backup of the current object
terraform plan                                           # anything created since that version shows as new -> import it

# Stuck lock: confirm no running apply in CI first
terraform force-unlock 6b2f1e1c-7d6a-4c0e-9f1d-2a4b7c8d9e0f
~~~
~~~hcl
resource "aws_kms_key" "ledger" {
  description         = "Ledger encryption key"
  enable_key_rotation = true
  lifecycle { prevent_destroy = true }      # plan errors instead of scheduling key deletion
}
~~~`,
  dia: r`flowchart TD
  F[Terraform failure] --> P{Type}
  P -->|partial apply| RP[Fix cause, re-plan carefully, re-apply]
  P -->|stuck lock| UL[Confirm no apply running, force-unlock]
  P -->|state corrupt/lost| RS[Restore version or import from scratch]
  P -->|deleted outside TF| BK[Restore data from backup, import]
  P -->|provider bug| PV[Pin/rollback provider, ignore_changes temporarily]
  PREV[Prevention: policies, prevent_destroy, deletion protection, small stacks] -.-> F`,
  pts: [r`Partial applies: fix, re-plan, read carefully, re-apply.`, r`Force-unlock only after confirming no apply runs.`, r`Versioned state enables restore; import rebuilds lost state.`, r`Pin and test provider upgrades; temporary ignore_changes for bugs.`, r`Prevent destruction with policy, prevent_destroy and cloud deletion protection.`],
  ex: r`A provider upgrade planned replacement of a production KMS key because of a changed default; prevent_destroy failed the plan and the team pinned the previous provider version until a fix shipped.`,
  fu: [r`How do you rebuild state for 200 resources after total loss?`, r`Why keep cloud deletion protection if Terraform already has prevent_destroy?`],
  pit: [r`Blind force-unlocks.`, r`State surgery without backups.`, r`Relying on a single safety net against destruction.`] },

{ id: 'q21', level: 'Senior', tags: ['iac-tools', 'pulumi', 'crossplane', 'opentofu', 'bicep'],
  q: r`Compare IaC tools for an enterprise: Terraform/OpenTofu, Pulumi, AWS CDK/CloudFormation, Bicep, and Crossplane. Include licensing, state handling, language, multi-cloud, and how you would choose.`,
  a: r`| Tool | Language | State | Scope | Notable |
|---|---|---|---|---|
| **Terraform** | HCL | self-managed backend or Terraform Cloud/Enterprise | multi-cloud + SaaS providers (huge ecosystem) | Business Source Licence since 2023; HashiCorp now part of IBM |
| **OpenTofu** | HCL | same model | same providers ecosystem (registry compatible) | open-source (MPL) fork under the Linux Foundation; features such as client-side state encryption |
| **Pulumi** | C#, TypeScript, Python, Go, Java | Pulumi Cloud or self-managed backends | multi-cloud | real programming languages, unit testing, component reuse; risk of over-engineering infra code |
| **AWS CDK / CloudFormation** | TypeScript, C#, Python... → CloudFormation | AWS-managed stacks | AWS only | rollbacks, drift detection, no state files to manage |
| **Bicep / ARM** | Bicep DSL | Azure-managed (deployments, deployment stacks) | Azure only | day-one Azure API coverage, no state file |
| **Crossplane** | Kubernetes CRDs + compositions | Kubernetes API (etcd) as state, continuous reconciliation | multi-cloud | control-plane approach: self-service infra via Kubernetes APIs; needs a well-run cluster |

**Selection criteria**
- **Cloud footprint**: single cloud may favour native tools (no state management, best API coverage); multi-cloud and SaaS (GitHub, Datadog, PagerDuty, Cloudflare) favour Terraform/OpenTofu/Pulumi.
- **Team skills**: platform engineers comfortable with HCL vs application developers who prefer C#/TypeScript (Pulumi/CDK); .NET teams can use C# with CDK or Pulumi.
- **Licensing and vendor strategy**: BSL implications (primarily for competitors offering Terraform as a service), support contracts, open governance preference (OpenTofu).
- **Operating model**: PR-driven plan/apply vs continuous reconciliation (Crossplane, GitOps-style).
- **Ecosystem**: modules, policy tooling (Sentinel/OPA/Checkov), drift detection, enterprise features.
- **Migration cost** from what already exists.

**Common enterprise outcome**: Terraform or OpenTofu as the default for cloud foundations and SaaS, cloud-native tools where a team is single-cloud and benefits (Bicep for Azure landing zones, CDK for AWS app stacks), Crossplane only where a Kubernetes-centric platform offers infra self-service. Avoid having every team pick a different tool without ownership boundaries.`,
  code: r`~~~csharp
// Pulumi in C#: same resource as HCL, with real language features and unit tests
using Pulumi;
using Pulumi.Aws.S3;

return await Deployment.RunAsync(() =>
{
    var bucket = new BucketV2("statements", new BucketV2Args
    {
        Bucket = "bank-statements-prod-euw1",
        Tags = { ["owner"] = "payments", ["env"] = "prod" }
    });
    _ = new BucketPublicAccessBlock("statements-pab", new BucketPublicAccessBlockArgs
    {
        Bucket = bucket.Id, BlockPublicAcls = true, BlockPublicPolicy = true, IgnorePublicAcls = true, RestrictPublicBuckets = true
    });
    return new Dictionary<string, object?> { ["bucketName"] = bucket.Id };
});
~~~
~~~yaml
# Crossplane claim: a team requests a database through the Kubernetes API (composition defines the details)
apiVersion: platform.bank.example/v1alpha1
kind: PostgresInstance
metadata: { name: statements-db, namespace: statements }
spec: { size: small, version: "16", backupRetentionDays: 35, deletionProtection: true }
~~~`,
  dia: r`flowchart TD
  Q[Choose IaC] --> C{Single cloud?}
  C -->|AWS only| CDK[CDK / CloudFormation]
  C -->|Azure only| BIC[Bicep]
  C -->|multi-cloud + SaaS| T{Licensing / governance preference}
  T -->|commercial support, ecosystem| TF[Terraform]
  T -->|open governance| OT[OpenTofu]
  C -->|developers prefer C#/TS| PU[Pulumi]
  C -->|Kubernetes platform self-service| XP[Crossplane]`,
  pts: [r`Terraform/OpenTofu: HCL, broad providers, self-managed state; licence differences.`, r`Pulumi: general-purpose languages and tests; avoid over-engineering.`, r`CDK/CloudFormation and Bicep: native, no state files, single cloud.`, r`Crossplane: continuous reconciliation via Kubernetes APIs.`, r`Choose by footprint, skills, licensing, operating model and migration cost; set ownership boundaries.`],
  ex: r`A bank standardised on OpenTofu for cloud foundations and SaaS providers after a licensing review, kept Bicep for its Azure landing zone, and allowed CDK in C# for a few AWS-only application teams with clear boundaries.`,
  fu: [r`What does the Terraform BSL change mean for an enterprise user?`, r`When does continuous reconciliation (Crossplane) beat PR-driven plans?`],
  pit: [r`Every team choosing a different tool.`, r`Overly clever Pulumi code nobody can review.`, r`Ignoring state management cost when choosing.`] },

{ id: 'q22', level: 'Senior', tags: ['progressive-delivery', 'automated-rollback', 'metrics'],
  q: r`Automate release decisions: canary analysis with technical and business metrics, statistical pitfalls, automatic rollback versus roll forward, and how to make the system trustworthy enough that people stop overriding it.`,
  a: r`**Goal**: humans should not stare at dashboards during releases; the system compares the new version against the baseline and decides.

**What to measure**
- **Technical**: error rate, latency percentiles (p95/p99), saturation, crash/restart counts, dependency errors.
- **Business**: authorisation approval rate, checkout conversion, payment success by PSP, orders per minute — catches "200 OK but wrong" bugs.
- Compare **canary vs baseline** (a fresh baseline pod set running the old version alongside the canary is better than comparing with historic data, which includes noise and different traffic mixes).

**Statistical pitfalls**
- Low traffic: 5% of a low-volume service gives too few requests for meaningful comparison — lengthen steps, use larger canary percentages, or synthetic traffic.
- Seasonality and traffic mix: compare at the same time, same traffic distribution (consistent hashing so users stick to one version).
- Multiple metrics multiply false alarms: choose a small set of decisive metrics with tuned thresholds; use tools with statistical tests (Kayenta-style Mann-Whitney comparisons, Argo Rollouts/Flagger analyses).

**Rollback vs roll forward**
- **Automatic rollback** for clear regressions during rollout: fastest mitigation, no human needed.
- **Roll forward** (deploy a fix) when rollback is impossible or riskier: irreversible schema/data changes already applied, messages emitted in a new format, external side effects. Design changes so rollback stays possible (expand/contract, feature flags).
- Feature flags as an even faster rollback for the risky part.

**Making it trustworthy**
- Start in "advisory" mode (report only) and compare its decisions with human judgement; tune thresholds; then enable automatic aborts.
- Make decisions explainable: which metric failed, by how much, link to graphs.
- Remove manual override paths for production (or require a recorded reason and second approver) — overrides are a common incident cause.
- Review false positives/negatives in postmortems and adjust.`,
  code: r`~~~yaml
# Flagger canary with technical + business metrics and automatic rollback
apiVersion: flagger.app/v1beta1
kind: Canary
metadata: { name: payments-api, namespace: payments }
spec:
  targetRef: { apiVersion: apps/v1, kind: Deployment, name: payments-api }
  service: { port: 80, targetPort: 8080 }
  analysis:
    interval: 1m
    threshold: 3               # failed checks before rollback
    maxWeight: 50
    stepWeight: 10
    metrics:
      - name: request-success-rate
        thresholdRange: { min: 99.5 }
        interval: 1m
      - name: request-duration
        thresholdRange: { max: 400 }   # ms p99
        interval: 1m
      - name: authorisation-approval-rate
        templateRef: { name: approval-rate, namespace: flagger }
        thresholdRange: { min: 92 }    # business metric: % approved
        interval: 2m
~~~`,
  dia: r`flowchart LR
  DEP[New version] --> CAN[Canary 10 percent]
  BASE[Baseline pods - old version] --> CMP{Compare canary vs baseline}
  CAN --> CMP
  CMP -->|technical + business metrics ok| STEP[Increase weight]
  CMP -->|regression| RB[Automatic rollback]
  RB -->|irreversible change shipped| RF[Roll forward fix / flag off]`,
  pts: [r`Let the system judge releases with technical and business metrics.`, r`Compare against a concurrent baseline; beware low traffic and metric multiplicity.`, r`Automatic rollback for regressions; roll forward when rollback is unsafe.`, r`Design for rollback with expand/contract and flags.`, r`Earn trust: advisory mode, explainable decisions, no casual overrides.`],
  ex: r`A card platform's canary passed error checks but approval rate fell from 94% to 88% on a fraud-rule change; the business metric triggered an automatic rollback at 10% traffic.`,
  fu: [r`How do you canary a low-traffic internal service?`, r`What makes a release impossible to roll back?`],
  pit: [r`Only HTTP error rates as criteria.`, r`Comparing with yesterday's metrics.`, r`Manual overrides without accountability.`] },

{ id: 'q23', level: 'Senior', tags: ['rollback', 'irreversibility', 'side-effects', 'design'],
  q: r`"Just roll back" — when does that not work? Analyse irreversible changes (schemas, data migrations, message formats, external side effects, configuration and infrastructure) and how to design releases so recovery is always possible.`,
  a: r`**Rollback works** when the old version can run correctly against the current state of everything it touches. It fails when the new version changed **shared state** in a way the old version cannot handle.

**Irreversible change types**
| Change | Why rollback fails | Design for recovery |
|---|---|---|
| **Destructive schema change** (drop/rename column, change type) | old code queries missing columns | expand/contract; contract only after the old version is unreachable |
| **Data migration / transformation** | data rewritten into a new shape; old code misreads it | dual-write and backfill, keep old data until verified; reversible transforms; backups and PITR |
| **New message/event format** | consumers (old or other teams') cannot parse; events already published remain | tolerant readers, additive changes, schema registry compatibility, version fields; upgrade consumers first |
| **External side effects** (payments sent, emails, partner API calls) | cannot un-send money or notifications | idempotency, feature flags, gradual exposure, compensating actions (refunds), reconciliation |
| **Cache formats / serialized state** | old version cannot deserialize new cache entries | versioned cache keys; tolerate both |
| **Configuration and secrets** (rotated credentials, new endpoints) | old version holds outdated config | dual credentials during rotation; config versioned with releases |
| **Infrastructure** (deleted resources, changed network rules, KMS key changes) | rollback of code does not restore infra | separate infra changes from app changes; staged infra rollouts; deletion protection |
| **Client apps** (mobile/SPA cached) | old clients persist after backend rollback | backward-compatible APIs; versioned endpoints |

**Release design principles**
1. **Separate deploy from release** with flags; risky behaviour behind a kill switch.
2. **Additive first, destructive later** — and destructive steps in their own release after a soak period.
3. **One risky change per release** — do not combine schema, message and behaviour changes.
4. **Rehearse rollback** in staging for significant releases; include rollback steps in the change plan.
5. **Forward-fix readiness**: fast pipeline so a fix can ship in minutes when rollback is impossible.
6. **Reconciliation** to detect and correct inconsistent data after incidents (especially money).`,
  code: r`~~~csharp
// Tolerant reader: consumers accept both v1 and v2 of PaymentCaptured, so producers can roll back or forward
public sealed record PaymentCaptured(string PaymentId, long AmountMinor, string Currency, int SchemaVersion = 1)
{
    public string? MerchantCategoryCode { get; init; }    // added in v2, optional
}

// Versioned cache key: old and new versions never read each other's cache entries
var key = $"merchant-config:v{MerchantConfig.SchemaVersion}:{merchantId}";

// Side effect behind a kill switch + idempotency key: disabling stops new payouts immediately
if (await flags.GetBooleanValueAsync("instant-payouts", false, ctx))
    await psp.PayoutAsync(request with { IdempotencyKey = $"payout-{request.PayoutId}" }, ct);
~~~`,
  dia: r`flowchart TD
  CH[Planned change] --> Q{Touches shared state?}
  Q -->|no| SAFE[Rollback safe]
  Q -->|schema| EC[Expand/contract across releases]
  Q -->|messages| TR[Tolerant readers, consumers first]
  Q -->|external side effects| FL[Flags + idempotency + compensation]
  Q -->|infra| SEP[Separate infra release, protection]
  EC --> R[Recovery always possible]
  TR --> R
  FL --> R
  SEP --> R`,
  pts: [r`Rollback fails when shared state changed in ways the old version cannot handle.`, r`Schemas, data, messages, side effects, caches, config and infra are the usual traps.`, r`Additive first, destructive later, one risky change per release.`, r`Flags and idempotency contain side effects; reconciliation repairs data.`, r`Rehearse rollback and keep forward-fix pipelines fast.`],
  ex: r`A release changed an event format and was rolled back after an error spike, but 40,000 new-format events were already in Kafka and crashed older consumers; tolerant readers became mandatory for all event schemas.`,
  fu: [r`How do you roll back a release that already sent payment instructions?`, r`What belongs in a release plan's rollback section?`],
  pit: [r`Combining schema, message and behaviour changes in one release.`, r`Assuming rollback undoes data migrations.`, r`No kill switch for side-effecting features.`] },

{ id: 'q24', level: 'Senior', tags: ['error-budget-policy', 'sre', 'prioritisation'],
  q: r`Write and operate an error budget policy: what triggers it, what changes when the budget is exhausted, exceptions, how it interacts with roadmaps, and how to handle dependencies that consume your budget.`,
  a: r`**Purpose**: a pre-agreed contract between product, engineering and operations about what happens when reliability falls below target — so the decision is made calmly in advance, not argued during a crisis.

**Typical policy content**
- **Scope**: which services/SLOs, measurement window (28 or 30 days rolling).
- **Triggers**: budget exhausted (or projected to exhaust within the window); a single incident consuming more than a threshold (for example 20%) of the budget triggers a mandatory postmortem.
- **Consequences when exhausted**:
  - Feature releases paused except critical fixes and security patches (or allowed only with extra safeguards: smaller canaries, manual approval).
  - The team prioritises reliability work from postmortem actions and the top contributors to budget burn.
  - Additional review for risky changes; possibly temporary on-call reinforcement.
- **Exit criteria**: budget recovered to a positive level, or top action items completed.
- **Exceptions**: business-critical launches (regulatory deadlines) with explicit sign-off by a named executive, recorded and reviewed.
- **Escalation**: disagreements go to an agreed decision-maker (for example VP engineering + product owner).

**Interaction with roadmaps**: reliability work is planned capacity, not an afterthought; error budget status is visible in planning (quarterly and sprint). Healthy budgets allow faster experimentation — the policy cuts both ways.

**Dependencies consuming your budget**
- Attribute burn to causes (own code, platform, third-party PSP, cloud provider). The policy should focus on what the team can influence: resilience to dependency failures (timeouts, retries with budgets, circuit breakers, fallback PSPs, caching).
- Agree dependency SLOs and escalate repeated dependency issues; consider excluding clearly external, contractually managed outages from internal enforcement while still tracking them (but users still felt it).
- Your SLO cannot realistically exceed the combined availability of hard dependencies without redundancy.

**Operating it**: weekly SLO review, burn dashboards, a lightweight log of policy activations and outcomes, and periodic recalibration of SLOs (too strict causes constant freezes; too loose means users suffer).`,
  code: r`~~~markdown
# Error Budget Policy - Payments Authorisation (v2, approved 2026-09-01)
SLO: 99.95% of authorisations succeed < 500 ms, 28-day rolling.
Triggers
- Budget remaining < 0, or projected < 0 within 7 days at current burn.
- Any single incident consuming > 20% of budget -> postmortem within 5 working days.
When triggered
- Feature releases paused; allowed: security patches, reliability fixes, regulatory changes (VP sign-off).
- Sprint capacity: >= 50% on top budget-burn contributors until budget > 25%.
- Canary max step 5%, analysis window doubled.
Dependencies
- Burn attributed to PSPs tracked separately; repeated PSP burn -> resilience work (failover PSP, timeouts).
Review: weekly SLO review; policy reviewed quarterly by Payments Eng + Product.
~~~`,
  dia: r`flowchart LR
  SLO[SLO tracking - 28 day window] --> B{Budget remaining?}
  B -->|healthy| FAST[Normal or faster releases, experiments]
  B -->|exhausted / projected| FREEZE[Policy: pause features, reliability focus]
  FREEZE --> FIX[Top burn contributors fixed]
  FIX --> SLO
  EXC[Exception: named exec sign-off, recorded] -.-> FREEZE
  DEP[Dependency burn attribution] --> RES[Resilience work: failover, timeouts]`,
  pts: [r`Pre-agreed contract on what happens when reliability falls below target.`, r`Triggers, consequences, exit criteria, exceptions and escalation spelled out.`, r`Reliability work is planned capacity; healthy budgets allow faster delivery.`, r`Attribute burn; invest in resilience to dependencies.`, r`Review weekly and recalibrate SLOs periodically.`],
  ex: r`When a PSP outage repeatedly consumed a payments team's budget, the policy drove a secondary-PSP failover project; the next PSP outage cost 3% of the budget instead of 60%.`,
  fu: [r`What if the business refuses to pause a launch?`, r`How do you set the exit criteria so freezes do not drag on?`],
  pit: [r`Policies nobody agreed to in advance.`, r`Freezing forever because SLOs are unrealistic.`, r`Ignoring dependency-driven burn.`] },

{ id: 'q25', level: 'Senior', tags: ['postmortems', 'blameless', 'learning', 'contributing-factors'],
  q: r`What makes a postmortem genuinely useful? Cover blameless culture, contributing factors versus a single root cause, the limits of "5 whys", writing good action items, and making learning spread across the organisation.`,
  a: r`**Blameless** means analysing how the **system** (tools, processes, incentives, information) made the failure possible, assuming people acted reasonably with what they knew at the time. Blame causes people to hide information, which destroys learning. Blameless is not accountability-free: teams own the follow-up actions.

**Contributing factors, not "the root cause"**
- Real incidents in complex systems have **multiple contributing factors**: a latent bug, a missing alert, a manual override, an ambiguous runbook, time pressure, a dependency change.
- "5 whys" can be useful for a quick drill-down but tends to produce one linear chain ending at a convenient person or "human error". Better: map factors in categories (technical, process, detection, response, organisational) and ask "what made this possible / what made it worse / what helped".
- "Human error" is a starting point for inquiry, never a conclusion: why was the error easy to make and hard to detect?

**Structure of a good postmortem**
1. Summary and **customer/business impact** (duration, users affected, money, regulatory relevance).
2. **Timeline** with detection, decision points and actions (from the scribe's notes and system data).
3. Contributing factors and what went well (detection, mitigation, communication).
4. Where we got lucky (latent risks).
5. **Action items** and open questions.

**Action items that matter**
- Specific, owned, dated, tracked in the normal backlog (not a separate document nobody reads).
- Prefer **systemic** fixes (automation, guardrails, design changes) over "be more careful" or "add a checklist step".
- Classify: prevent recurrence, improve detection, improve mitigation, reduce blast radius.
- Track completion rate; unfinished actions from SEV1s are reviewed by leadership.

**Spreading learning**: postmortem reviews open to all engineers, a searchable repository with tags (dependency, deployment, database), quarterly themes analysis (for example 40% of incidents follow config changes → invest in config validation), and incident simulations based on past events.`,
  code: r`~~~markdown
# Postmortem: EU card authorisation failures (SEV1, 2026-10-11)
## Impact
09:12-09:29 UTC, ~18% of EU authorisations declined (~41,000 attempts); no duplicate charges; regulatory assessment: not major.
## Timeline (excerpt)
09:05 deploy of payments-api 4.18 with manual "skip canary" override (release pressure for partner deadline)
09:12 error rate rises; 09:14 SLO fast-burn page; 09:23 IC decides rollback; 09:29 recovered
## Contributing factors
- Technical: new PSP client timeout default (2 s) shorter than PSP p99 under load
- Process: canary skippable by any deployer without second approval
- Detection: worked (2 min); dashboard lacked per-PSP breakdown, delaying diagnosis by ~5 min
- Organisational: partner deadline pressure encouraged skipping safety steps
## What went well / where we got lucky
Fast rollback; failure hit a low-traffic hour.
## Actions
| Action | Type | Owner | Due |
| Remove canary skip; emergency path requires 2 approvers + reason | prevent | platform | 2026-10-25 |
| Contract test for PSP client timeouts vs PSP SLO | prevent | payments | 2026-10-31 |
| Per-PSP error panel + alert | detect | sre | 2026-10-18 |
~~~`,
  dia: r`flowchart LR
  INC[Incident] --> TL[Timeline from data + scribe]
  TL --> CF[Contributing factors: technical, process, detection, response, org]
  CF --> ACT[Systemic action items - owned, dated]
  ACT --> BL[Normal backlog + leadership review]
  CF --> REPO[Searchable postmortem library]
  REPO --> THEMES[Quarterly themes -> investments]`,
  pts: [r`Blameless: examine the system; people keep ownership of actions.`, r`Multiple contributing factors, not a single root cause; human error is a starting point.`, r`Include impact, timeline, factors, what went well, luck and actions.`, r`Systemic, owned, dated actions tracked to completion.`, r`Share widely and analyse themes across incidents.`],
  ex: r`Theme analysis across 60 postmortems showed most SEV1s followed configuration changes; investment in config validation and canaries for config cut config-related incidents by two thirds the following year.`,
  fu: [r`How do you keep postmortems blameless when an executive wants a name?`, r`How do you make sure action items actually get done?`],
  pit: [r`Concluding "human error".`, r`Action items like "be more careful".`, r`Postmortems filed and never read.`] },

{ id: 'q26', level: 'Senior', tags: ['toil', 'automation', 'sre', 'roi'],
  q: r`Define toil, measure it, and decide what to automate. How do you justify automation investments and avoid automating the wrong things?`,
  a: r`**Toil** (Google SRE definition): work that is **manual, repetitive, automatable, tactical (interrupt-driven), without enduring value, and scales linearly with service growth**. Examples: manually provisioning accounts, restarting stuck jobs, rotating certificates by hand, copying data for support requests, approving routine access, running monthly release checklists.

Not toil: incident response requiring judgement, design work, one-off investigations, writing automation.

**Why it matters**: toil grows with the business; if 70% of a team's time is toil, it cannot improve the system and burns out. SRE guidance caps toil at about **50%** of an engineer's time, with the rest on engineering that reduces future toil.

**Measuring**
- Tag tickets and on-call work as toil; short time-tracking surveys per sprint; count interrupts per week.
- Inventory recurring tasks with frequency × duration × number of people.

**Prioritising automation**
- Value = time saved (frequency × duration) + **risk reduced** (manual steps cause errors and incidents) + speed (lead time for customers/teams) + compliance (consistent evidence).
- Cost = build + maintenance + the risk of automation going wrong at scale.
- Classic heuristic: automate when (time saved over a period) > (time to automate + maintain); but weight risk and lead time heavily in regulated environments — a manual production change once a month can still justify automation if it causes incidents.

**Avoid automating the wrong things**
- First ask whether the task should exist at all (eliminate > automate): remove approvals that add no control value, fix the bug causing stuck jobs.
- Do not automate a broken process — simplify it first.
- Make automation safe: idempotent, observable, with dry-run mode, limits (blast radius), and audit logs.
- Prefer **self-service** (teams do it themselves through a portal/API with guardrails) over a central team running scripts on request.

**Showing ROI**: before/after toil hours, ticket volume, lead time for the task, error/incident counts — reported quarterly.`,
  code: r`~~~text
Toil inventory (platform team, quarter Q3)
Task                               Freq/month  Minutes  People  Hours/month  Risk  Action
Create service namespace + RBAC        40         45       1         30       med   Self-service via portal (done Q4)
Restart stuck settlement job           22         20       1          7       high  Fix root cause (idempotent resume)
Rotate TLS certs manually              12         60       1         12       high  cert-manager + alerts
Grant temp prod read access            60         10       1         10       med   JIT access with auto-expiry
Monthly patch evidence pack             1        480       2         16       low   Generate from pipeline data
Total toil: 75 h/month (~47% of team capacity)
~~~`,
  dia: r`flowchart TD
  TASK[Recurring manual task] --> E{Should it exist?}
  E -->|no| ELIM[Eliminate: remove step or fix cause]
  E -->|yes| S{Simplify first?}
  S --> AUTO[Automate safely: idempotent, dry-run, limits, audit]
  AUTO --> SELF[Offer as self-service with guardrails]
  SELF --> MEAS[Measure hours saved, incidents avoided, lead time]`,
  pts: [r`Toil is manual, repetitive, automatable, tactical, without lasting value, and scales with growth.`, r`Cap toil (about 50%) so teams can improve systems.`, r`Measure via ticket tagging and inventories.`, r`Prioritise by time, risk, speed and compliance; eliminate before automating.`, r`Build safe, self-service automation and report ROI.`],
  ex: r`A platform team spent 30 hours a month creating namespaces by ticket; a self-service portal with guardrails reduced it to zero and cut team onboarding lead time from 3 days to 10 minutes.`,
  fu: [r`How would you convince leadership to fund toil reduction over features?`, r`What makes automation dangerous?`],
  pit: [r`Automating a broken process.`, r`Central scripts run on request instead of self-service.`, r`Not measuring toil at all.`] },

{ id: 'q27', level: 'Senior', tags: ['change-management', 'cab', 'regulated', 'continuous-delivery'],
  q: r`How do you reconcile continuous delivery with change management in a regulated bank? Discuss CABs, the research on approvals, standard versus normal versus emergency changes, and automating change evidence.`,
  a: r`**The tension**: traditional change management (ITIL CAB meetings weekly) aims to reduce risk by review; continuous delivery deploys many small changes daily. Regulators (SOX ITGC, PCI DSS, prudential regulators, DORA) require **controlled** change — not necessarily slow change.

**What the research says**: the Accelerate/DORA research found external approval bodies (CABs) were **not correlated with lower change failure rates** and were associated with slower delivery. Lightweight peer review plus automated testing and deployment correlated with better outcomes. The risk is in big, infrequent changes; CABs encourage batching.

**Control objectives regulators care about** (what to prove, not how)
- Changes are authorised (someone accountable approved).
- Segregation of duties (the author does not approve and deploy alone).
- Changes are tested before production.
- Changes are traceable (who, what, when, why) and reversible.
- Emergency changes are controlled and reviewed afterwards.

**A modern change model**
| Change type | Example | Control |
|---|---|---|
| **Standard (pre-approved)** | application deploys via the pipeline that meets all gates | automated: PR approval by another engineer, tests, scans, progressive delivery; evidence generated automatically; no CAB |
| **Normal** | major architecture changes, database platform migrations, network topology changes | risk assessment, peer/architecture review, scheduled window if needed |
| **Emergency** | incident fix | expedited path (incident commander + second engineer), logged, retrospective review within days |

**Automating evidence**: the pipeline creates the change record (ServiceNow/Jira) automatically with links to the PR, approvals, test and scan results, deployment logs and the running artefact digest; auditors sample from the system. Segregation of duties is enforced technically (branch protection, environment reviewers, deployers cannot approve their own PRs).

**Getting there**: partner with risk/compliance/audit early, map controls to automated evidence, pilot with one team, show metrics (change failure rate, lead time) and audit results, then reclassify pipeline deploys as standard changes.`,
  code: r`~~~yaml
# Pipeline step: create the change record automatically with evidence links (standard change)
- name: Register standard change
  run: |
    curl -sf -X POST "$SNOW_URL/api/now/table/change_request" \
      -H "Authorization: Bearer $SNOW_TOKEN" -H "Content-Type: application/json" \
      -d @- <<EOF
    { "type": "standard", "template": "pipeline-deploy-payments",
      "short_description": "payments-api $VERSION to prod",
      "u_pr_url": "$PR_URL", "u_approver": "$PR_APPROVER", "u_author": "$PR_AUTHOR",
      "u_test_report": "$TEST_REPORT_URL", "u_scan_report": "$SCAN_REPORT_URL",
      "u_artifact_digest": "$IMAGE_DIGEST", "u_pipeline_run": "$RUN_URL" }
    EOF
~~~`,
  dia: r`flowchart LR
  PR[PR approved by second engineer] --> GATES[Automated tests, scans, policy]
  GATES --> DEP[Progressive deploy]
  DEP --> REC[Change record auto-created with evidence]
  REC --> AUD[Auditors sample from system]
  NORMAL[Normal change: risk review] --> DEP
  EMERG[Emergency: IC + 2nd engineer] --> DEP
  EMERG --> RETRO[Retrospective review]`,
  pts: [r`Regulators require controlled change, not slow change.`, r`Research: CABs do not reduce failure rates; small automated changes do.`, r`Standard, normal and emergency change types with proportionate controls.`, r`Enforce segregation of duties technically; generate evidence automatically.`, r`Partner with risk and audit; pilot, measure, then reclassify.`],
  ex: r`A bank reclassified pipeline deployments as standard changes after auditors accepted automated evidence; deployment frequency rose from monthly to daily while change failure rate fell from 18% to 6%.`,
  fu: [r`How do you prove segregation of duties in a small team?`, r`What still needs a human review board?`],
  pit: [r`Weekly CABs for every deployment.`, r`Manual evidence screenshots.`, r`Emergency changes without retrospective review.`] },

{ id: 'q28', level: 'Senior', tags: ['dependency-management', 'renovate', 'dependency-confusion', 'supply-chain'],
  q: r`Manage third-party dependencies at scale: lock files, automated update PRs, internal package proxies, dependency confusion and typosquatting, licence compliance, and deciding when to vendor or fork.`,
  a: r`**Reproducibility**: lock files ({{packages.lock.json}} with {{RestorePackagesWithLockFile}} for NuGet, {{package-lock.json}} with {{npm ci}}) so builds use exactly reviewed versions; central package management ({{Directory.Packages.props}}) to keep versions consistent across .NET projects.

**Automated updates**: Renovate or Dependabot open PRs for new versions — grouped (all patch updates weekly), scheduled, with auto-merge for patches/minors that pass CI in well-tested services; majors require review with changelogs. Staying current in small steps is cheaper and safer than rare big-bang upgrades (and security fixes land fast).

**Internal package proxies** (Artifactory, Azure Artifacts, ProGet, Nexus, GitHub Packages)
- All builds pull through the proxy: caching, availability during public registry outages, a single place to block malicious or banned packages and enforce policies (age quarantine — for example, do not consume versions published less than N days ago).
- Developer machines configured to use it (nuget.config, .npmrc).

**Dependency confusion and typosquatting**
- **Dependency confusion**: an attacker publishes a public package with the same name as your internal one and a higher version; misconfigured resolution prefers the public one. Defences: **package source mapping** in NuGet ({{packageSourceMapping}}) and scoped registries in npm ({{@bank:registry}}), reserved prefixes/namespaces on public registries, proxies that never resolve internal names externally.
- **Typosquatting** ({{Newtonsoft.Jsom}}): allow-lists or review of new dependencies, SCA tools that flag suspicious packages, package age/popularity checks.
- **Compromised maintainers**: pin versions, monitor advisories, provenance/signing where available (npm provenance, NuGet signing).

**Licence compliance**: SCA tools report licences; policy blocks copyleft licences where not allowed for distributed software; SBOMs for audit.

**Vendor or fork when**: an abandoned dependency with a critical fix you need, extreme supply-chain sensitivity, or regulatory needs — but forks carry maintenance costs; prefer contributing upstream or replacing the dependency. Track "critical dependency health" (maintainers, release cadence, security posture — OpenSSF Scorecard).`,
  code: r`~~~xml
<!-- nuget.config: internal proxy + source mapping (defeats dependency confusion) -->
<configuration>
  <packageSources>
    <clear />
    <add key="internal" value="https://artifacts.bank.example/nuget/internal/index.json" />
    <add key="nuget-proxy" value="https://artifacts.bank.example/nuget/nuget-org-proxy/index.json" />
  </packageSources>
  <packageSourceMapping>
    <packageSource key="internal"><package pattern="Bank.*" /></packageSource>
    <packageSource key="nuget-proxy"><package pattern="*" /></packageSource>
  </packageSourceMapping>
</configuration>
~~~
~~~json
// renovate.json: grouped, scheduled updates; auto-merge safe ones; majors need approval
{
  "extends": ["config:recommended"],
  "schedule": ["before 7am on monday"],
  "minimumReleaseAge": "3 days",
  "packageRules": [
    { "matchUpdateTypes": ["patch", "minor"], "groupName": "non-major dependencies", "automerge": true },
    { "matchUpdateTypes": ["major"], "dependencyDashboardApproval": true }
  ]
}
~~~`,
  dia: r`flowchart LR
  PUB[nuget.org / npmjs] --> PROXY[Internal proxy: cache, block lists, age quarantine]
  INT[Internal packages Bank.*] --> PROXY
  PROXY -->|source mapping| BUILD[CI builds with lock files]
  REN[Renovate PRs - grouped, auto-merge patches] --> BUILD
  SCA[SCA: vulns + licences + suspicious packages] --> BUILD
  ATT[Attacker public Bank.Payments 99.0] -.blocked by mapping.-> PROXY`,
  pts: [r`Lock files and central package management for reproducibility.`, r`Automated, grouped update PRs; auto-merge safe ones; small frequent upgrades.`, r`Internal proxies for availability, policy and quarantine.`, r`Package source mapping and scoped registries defeat dependency confusion.`, r`Licence policy, SBOMs, and careful vendor/fork decisions.`],
  ex: r`A security test published a public package named like an internal Bank.* library; builds without source mapping pulled it in staging. NuGet source mapping across all repos closed the gap.`,
  fu: [r`What is the risk of auto-merging dependency updates?`, r`How do you handle an abandoned critical dependency?`],
  pit: [r`Builds pulling directly from public registries.`, r`No source mapping for internal package names.`, r`Rare big-bang dependency upgrades.`] },

{ id: 'q29', level: 'Senior', tags: ['incident', 'leaked-secret', 'response', 'rotation'],
  q: r`A production database password and a cloud access key were committed to a public GitHub repository 40 minutes ago. Walk through the response minute by minute, and the controls that should have prevented it.`,
  a: r`**Assume compromise immediately**: public repositories are scanned by attackers within minutes; deleting the commit does not help (forks, caches, scanners already have it).

**First 15 minutes — contain**
1. **Declare a security incident** (SEV1), assign IC, involve security/CSIRT.
2. **Revoke/rotate the cloud key now**: deactivate the access key; attach a deny-all policy to the user/role if needed; for roles, revoke active sessions. Check whether GitHub/the cloud provider's secret-scanning partner programme already quarantined it (AWS applies a quarantine policy to exposed keys it detects).
3. **Rotate the database password** using the dual-credential approach where possible — or accept a brief outage: change the password, update the secret store, restart/reload services. Restrict network access to the database to known sources if not already.
4. Make the repository private or remove the content (to stop further exposure), but **preserve evidence**.

**Next hours — investigate**
- Cloud audit logs (CloudTrail/Activity Log) for all actions by the leaked key since its creation, focusing on the exposure window: new IAM users/keys, roles, compute instances (crypto-mining), data access (S3 GetObject, snapshots shared), security changes (disabling logging).
- Database audit logs: logins from unknown IPs, large reads, privilege changes.
- If malicious activity: escalate containment (isolate resources, revoke created credentials, restore), engage forensics, assess data exposure.
- **Regulatory and legal assessment**: personal data or card data exposure triggers breach notification obligations (GDPR 72 hours to the regulator where required; DORA major incident reporting; PCI incident procedures).

**Recover and learn**
- Remove the secret from Git history (filter-repo/BFG) for hygiene, knowing it does not undo exposure.
- Blameless postmortem.

**Preventive controls**
- **Push protection** for secret scanning on all repositories (blocks pushes containing secrets); pre-commit hooks.
- **No long-lived keys**: OIDC federation for CI, workload identity for apps, IAM database auth; a long-lived access key should not exist to leak.
- Secrets only in vaults; local development via vault access, not copied files.
- Organisation settings: who can create public repositories; alerts for repository visibility changes.`,
  code: r`~~~bash
# Contain: deactivate the leaked key and revoke sessions of the affected role
aws iam update-access-key --user-name svc-reporting --access-key-id AKIAEXAMPLE123 --status Inactive
aws iam put-user-policy --user-name svc-reporting --policy-name deny-all-incident --policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Deny","Action":"*","Resource":"*"}]}'
# Investigate: everything the key did
aws cloudtrail lookup-events --lookup-attributes AttributeKey=AccessKeyId,AttributeValue=AKIAEXAMPLE123 \
  --start-time 2026-10-11T08:00:00Z --query 'Events[].{t:EventTime,n:EventName,src:CloudTrailEvent}' --output table
# Prevent: enable push protection for secret scanning org-wide (GitHub)
gh api -X PATCH /orgs/bank -f secret_scanning_push_protection_enabled_for_new_repositories=true
~~~`,
  dia: r`flowchart LR
  LEAK[Secret pushed to public repo] --> DECL[Declare SEV1 security incident]
  DECL --> CONT[Revoke key, rotate DB password, restrict access]
  CONT --> INV[Audit logs: CloudTrail, DB logins, data access]
  INV --> REG[Regulatory / legal assessment]
  INV --> REC[Recover + history cleanup]
  REC --> PM[Postmortem]
  PREV[Push protection, no long-lived keys, vault-only] -.would have prevented.-> LEAK`,
  pts: [r`Assume compromise; deleting the commit does not undo exposure.`, r`Revoke and rotate within minutes; preserve evidence.`, r`Investigate everything the credentials did; check data access.`, r`Assess regulatory notification obligations early.`, r`Prevent with push protection and by eliminating long-lived keys.`],
  ex: r`An AWS key leaked publicly was used within 11 minutes to launch GPU instances in another region; because CloudTrail logged it, the team terminated the instances and the cost was limited to hours instead of days.`,
  fu: [r`How do you rotate a database password used by 30 services without downtime?`, r`What evidence would regulators expect after such an incident?`],
  pit: [r`Deleting the commit and considering it solved.`, r`Delaying rotation to avoid an outage.`, r`Not checking what the leaked credentials did.`] },

{ id: 'q30', level: 'Senior', tags: ['incident', 'terraform', 'destroyed-resource', 'prevention'],
  q: r`Incident: a Terraform apply in CI deleted a production DNS zone (or database) because a refactor changed resource addresses. Run the recovery and design prevention at every layer.`,
  a: r`**Recovery**
1. **Declare SEV1**; IC assigned; freeze further applies on affected stacks (lock the pipeline).
2. **Restore the resource**:
   - DNS zone: recreate the hosted zone and records from IaC (code still describes the records) — but a new hosted zone may get **new name servers**; the registrar/parent delegation must be updated, and DNS caches (TTL of NS records, often 48 hours) prolong impact. Lower TTLs in advance where possible; some providers allow restoring with the same name servers via reusable delegation sets.
   - Database: restore from automated snapshots/PITR (RDS/Azure SQL retain backups after deletion only if configured — final snapshot or backup retention settings matter); reconnect applications; reconcile data written after the restore point (outbox, PSP files).
3. **Re-import** restored resources into state and verify a no-change plan.
4. Communicate (customers, partners if DNS affected), then postmortem.

**How it happened (typical)**: a refactor moved resources into a module without {{moved}} blocks; the plan showed "1 to destroy, 1 to add"; the reviewer missed it among a large diff; apply ran automatically after merge.

**Prevention in layers**
- **Code**: {{moved}} blocks for refactors; {{prevent_destroy}} on critical resources (zones, databases, KMS keys, buckets with data).
- **Plan review**: CI comments highlight destroys and replacements prominently; separate approval required when a plan destroys protected types.
- **Policy as code**: deny plans that delete resources of protected types unless an explicit override label is set by an authorised person.
- **Cloud-level protection** independent of Terraform: RDS/Aurora deletion protection, Azure resource locks, S3 Object Lock/versioning, Route 53 zone protection via IAM (deny DeleteHostedZone except break-glass role), final snapshots and long backup retention.
- **Blast radius**: critical shared resources (DNS zones, KMS keys, core networking) in their own small stacks with stricter approval, rarely changed.
- **Process**: large refactors reviewed separately from functional changes; dry-run in a staging copy of the stack.`,
  code: r`~~~hcl
resource "aws_route53_zone" "public" {
  name              = "bank.example"
  delegation_set_id = aws_route53_delegation_set.main.id   # reusable NS set eases recreation
  lifecycle { prevent_destroy = true }
}

resource "aws_db_instance" "ledger" {
  identifier                = "ledger-prod"
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "ledger-prod-final"
  backup_retention_period   = 35
  lifecycle { prevent_destroy = true }
}
~~~
~~~json
// SCP / IAM guardrail: only the break-glass role may delete hosted zones or DB instances in prod
{ "Version": "2012-10-17", "Statement": [ {
    "Sid": "ProtectCriticalResources", "Effect": "Deny",
    "Action": ["route53:DeleteHostedZone", "rds:DeleteDBInstance", "rds:DeleteDBCluster", "kms:ScheduleKeyDeletion"],
    "Resource": "*",
    "Condition": { "ArnNotLike": { "aws:PrincipalArn": "arn:aws:iam::*:role/BreakGlassAdmin" } } } ] }
~~~`,
  dia: r`flowchart TD
  REF[Refactor without moved block] --> PLAN[Plan: 1 destroy, 1 add]
  PLAN -->|missed in review| APPLY[Apply deletes prod resource]
  L1[prevent_destroy] -.blocks.-> PLAN
  L2[Policy: deny destroy of protected types] -.blocks.-> PLAN
  L3[Destroy highlighted + extra approval] -.catches.-> PLAN
  L4[Cloud deletion protection / SCP] -.blocks.-> APPLY
  L5[Backups, final snapshots, reusable NS] -.limits impact.-> APPLY`,
  pts: [r`Recover: freeze applies, restore from IaC or backups, re-import, verify no-change plan.`, r`DNS recreation can change name servers; database restores need data reconciliation.`, r`Root cause is usually a refactor without moved blocks and a missed destroy in review.`, r`Layered prevention: prevent_destroy, policy, highlighted destroys, cloud protection.`, r`Isolate critical shared resources in small, strictly governed stacks.`],
  ex: r`After an apply deleted a public hosted zone, a bank's site was unreachable for some resolvers for a day due to NS caching; protected-resource policies and reusable delegation sets were added across all accounts.`,
  fu: [r`Why do independent cloud-level protections matter if Terraform has prevent_destroy?`, r`How would you make destroys visible in a 500-line plan?`],
  pit: [r`Auto-apply after merge without destroy checks.`, r`skip_final_snapshot on production databases.`, r`Critical resources mixed into busy application stacks.`] },

{ id: 'q31', level: 'Senior', tags: ['incident', 'deployment', 'mttr', 'freeze'],
  q: r`After two deployment-caused outages, leadership proposes a deployment freeze and a weekly release window. How do you respond, and what would you do instead to reduce change failure rate and recovery time?`,
  a: r`**Acknowledge the concern, then use evidence**: freezes and big release windows **increase batch size**, which increases risk per release, makes failures harder to diagnose (many changes at once) and slows recovery. DORA research consistently shows high performers deploy more frequently **and** have lower change failure rates. A freeze might be justified briefly around exceptional business events (Black Friday, year-end close) with heightened readiness, not as the default.

**Understand the two outages first** (postmortems): what made them possible, why detection or mitigation was slow. Typical findings: missing canary or skipped canary, insufficient tests for a dependency change, config change with no validation, rollback slow or impossible due to schema changes, alerts too slow.

**What to do instead (concrete plan)**
1. **Smaller changes**: trunk-based development, small PRs, feature flags so incomplete work ships dark.
2. **Progressive delivery with automated analysis** for every production deployment, including configuration changes (canary config too).
3. **Fast, reliable rollback**: rehearsed, one command or automatic; expand/contract for schemas so rollback stays possible.
4. **Better pre-production signals**: contract tests with dependencies, integration tests against the built artefact, production-like staging for risky changes, load tests for performance-sensitive changes.
5. **Detection in minutes**: SLO burn-rate alerts, deploy markers on dashboards, business metrics.
6. **Remove unsafe overrides** (manual canary skips) or require two-person approval.
7. **Error budget policy**: when the budget is exhausted, slow down risky launches — a principled, temporary brake instead of a blanket freeze.

**Metrics to report back**: change failure rate, failed deployment recovery time, deployment frequency, lead time — monthly, with targets agreed with leadership. Offer a time-boxed experiment: three months of the plan versus the proposed freeze, judged on these metrics.

**Communication**: frame it as reducing risk (leadership's goal), not defending developer convenience.`,
  code: r`~~~text
Proposal to leadership (summary)
Goal: fewer customer-impacting changes, faster recovery.
Findings from 2 outages: canary manually skipped (1), schema change made rollback impossible (1).
Plan (90 days)
  1. Mandatory canary + automated analysis for all prod deploys, config included   (owner: platform, day 30)
  2. Remove manual canary skip; emergency path = 2 approvers                     (day 14)
  3. Expand/contract standard + migration lint in CI                              (day 45)
  4. Rollback drill per service each quarter; target recovery < 15 min            (day 60)
  5. Deploy markers + SLO burn alerts on all tier-1 services                      (day 30)
Targets: change failure rate 15% -> < 7%; recovery time 70 min -> < 20 min; deployment frequency maintained.
Freeze only for Black Friday week and year-end close, with on-call reinforcement.
~~~`,
  dia: r`flowchart LR
  FREEZE[Freeze + weekly window] --> BIG[Bigger batches] --> RISK[Higher risk per release, slower diagnosis]
  ALT[Alternative] --> SMALL[Small changes + flags]
  ALT --> CAN[Canary + automated analysis]
  ALT --> RB[Fast rollback, expand/contract]
  ALT --> DET[SLO burn alerts, deploy markers]
  SMALL --> LOW[Lower change failure rate, faster recovery]
  CAN --> LOW
  RB --> LOW
  DET --> LOW`,
  pts: [r`Freezes and release windows increase batch size and risk.`, r`Start from postmortem findings of the actual outages.`, r`Small changes, canaries with analysis, fast rollback, better tests, faster detection.`, r`Use error budget policies as a principled brake; freeze only for exceptional events.`, r`Agree metrics and a time-boxed experiment with leadership.`],
  ex: r`A payments division replaced a proposed monthly release window with mandatory canaries and rollback drills; change failure rate halved in a quarter and leadership dropped the freeze proposal.`,
  fu: [r`When is a change freeze genuinely appropriate?`, r`How do you handle a leader who insists despite the data?`],
  pit: [r`Accepting freezes as the default risk control.`, r`Arguing from developer convenience rather than risk.`, r`Proposing changes without measurable targets.`] },

{ id: 'q32', level: 'Senior', tags: ['metrics', 'dora', 'measurement', 'goodhart'],
  q: r`Instrument DORA and reliability metrics across 40 teams: data sources, definitions that hold up, handling edge cases (hotfixes, config changes, monorepos), dashboards, and preventing the metrics from being gamed or weaponised.`,
  a: r`**Data sources**
- **Version control**: commit timestamps, PR open/merge times, authors (for lead time segments: coding, review, waiting to deploy).
- **CI/CD and GitOps**: deployment events with service, environment, artefact digest, commits included, outcome (success, rolled back), timestamps.
- **Incident management**: incidents with start, mitigation, resolution, severity, and **causal link** to a deployment/change.
- **SLO platform**: reliability against objectives.
Collect via webhooks/events into a warehouse; open-source tooling (Four Keys-style pipelines, Apache DevLake) or commercial engineering intelligence tools.

**Definitions that hold up**
- **Deployment**: a successful change to production of a service (including configuration changes delivered through the pipeline); per service, not per pipeline run.
- **Lead time**: first commit (or merge) → running in production; report median and p90.
- **Change failure**: a deployment followed by rollback, hotfix, or an incident attributed to it within a window — attribution done in postmortems, not automatic guessing alone.
- **Recovery time**: incident start (impact) → mitigation, for change-caused incidents.

**Edge cases**
- Hotfixes count as deployments and often mark the previous one as failed.
- Config/feature-flag changes: track separately or include if they go through deployment; flags changes can cause incidents too — log them as changes.
- Monorepos: attribute commits to the services actually deployed.
- Batch deploys of many services: count per service.

**Dashboards**: per team trends (not rankings), drill-down from metric to underlying deployments/incidents, segmentation by service tier; quarterly review in team retrospectives.

**Preventing gaming and weaponisation**
- Metrics are for **teams to improve their system**, not for individual performance or bonuses.
- Pair speed metrics with stability metrics (deploying empty changes raises frequency but not value).
- Combine with qualitative signals (developer surveys, SPACE/DevEx) and outcomes (customer impact).
- Leadership discusses constraints revealed by metrics (slow approvals, flaky tests) and funds fixes.`,
  code: r`~~~json
// Deployment event emitted by every pipeline/GitOps sync into the metrics warehouse
{
  "event": "deployment",
  "service": "payments-api",
  "environment": "prod",
  "artifact_digest": "sha256:9c1e...",
  "commits": ["4f2a9c1", "77b0e3d", "9c1e2f7"],
  "change_type": "code",
  "started_at": "2026-10-11T08:58:12Z",
  "finished_at": "2026-10-11T09:05:40Z",
  "outcome": "success",
  "strategy": "canary",
  "pipeline_run": "https://ci.bank.example/runs/48211"
}
~~~`,
  dia: r`flowchart LR
  VCS[Git: commits, PRs] --> WH[(Metrics warehouse)]
  CD[CI/CD + GitOps deployment events] --> WH
  INC[Incidents with change attribution] --> WH
  SLO[SLO platform] --> WH
  WH --> DASH[Team trend dashboards - no rankings]
  DASH --> RETRO[Team retrospectives: constraints]
  RETRO --> FUND[Leadership funds fixes]`,
  pts: [r`Collect from Git, CI/CD, incident and SLO systems via events.`, r`Define deployment, lead time, change failure and recovery precisely.`, r`Handle hotfixes, config changes and monorepos explicitly.`, r`Team trend dashboards with drill-down, not league tables.`, r`Never use for individual performance; pair speed with stability and qualitative data.`],
  ex: r`Lead-time segmentation showed PRs waited a median of 26 hours for review; a review rota and smaller PRs cut overall lead time by 40% without changing pipelines.`,
  fu: [r`How do you attribute an incident to a deployment fairly?`, r`What would you do if a team's metrics look perfect but customers complain?`],
  pit: [r`Ranking teams by deployment frequency.`, r`Automatic change failure attribution with no human validation.`, r`Ignoring configuration and flag changes.`] },

{ id: 'q33', level: 'Senior', tags: ['chaos-engineering', 'game-days', 'resilience'],
  q: r`Introduce chaos engineering and game days in a risk-averse financial institution: hypotheses, starting small, safety controls, which experiments matter for payment systems, and how to gain organisational permission.`,
  a: r`**Chaos engineering**: running controlled experiments to verify that systems behave as expected under failure — building confidence (or finding weaknesses) before real incidents do. **Game days**: scheduled exercises (technical and human) simulating incidents to practise detection, response and communication.

**Method**
1. Define **steady state** with metrics (authorisation success rate, latency, queue age).
2. **Hypothesis**: "If one AZ loses the payments API pods, success rate stays above 99.9% and p99 below 400 ms."
3. **Experiment** with minimal blast radius: one service, one instance, non-production first.
4. **Stop conditions**: automatic abort if SLO metrics breach thresholds.
5. Observe, learn, fix, repeat; increase scope gradually.

**Experiments that matter for payments**
- Instance/pod/node termination; AZ loss (static stability).
- Dependency failures: PSP timeouts and errors (does the circuit breaker open, does failover to the secondary PSP work, are payments marked UNKNOWN rather than double-charged?).
- Database failover (Aurora/Azure SQL failover: retry behaviour, connection pools).
- Message broker partition or consumer lag; DLQ handling.
- Latency injection (slow responses are worse than errors for thread pools).
- Certificate expiry, DNS failure, secret rotation during traffic.
- Region failover drills (DR rehearsal) — the ultimate game day.

**Safety controls**: start in staging with production-like traffic replay, then production during low-traffic windows with clear stop buttons; tooling with guardrails (AWS FIS, Azure Chaos Studio, Gremlin, Chaos Mesh, Litmus); notify stakeholders; never run experiments that could cause irreversible financial side effects without stubs/sandbox PSPs.

**Gaining permission**
- Frame it as **risk reduction and regulatory resilience testing** (operational resilience rules — PRA/FCA impact tolerances, DORA resilience testing requirements — expect firms to test severe but plausible scenarios).
- Start with tabletop exercises and staging; share findings that prevented incidents.
- Involve risk, audit and business owners in designing and observing the first production experiments.`,
  code: r`~~~json
// AWS FIS experiment: inject latency into PSP calls from payments pods (via network fault on the PSP egress path)
{
  "description": "PSP latency 2s for 50% of payments-api tasks - verify circuit breaker + failover PSP",
  "targets": { "tasks": { "resourceType": "aws:ecs:task", "selectionMode": "PERCENT(50)",
      "resourceTags": { "service": "payments-api", "env": "staging" } } },
  "actions": { "latency": { "actionId": "aws:ecs:task-network-latency",
      "parameters": { "duration": "PT10M", "delayMilliseconds": "2000", "sources": "api.psp-primary.example" },
      "targets": { "Tasks": "tasks" } } },
  "stopConditions": [ { "source": "aws:cloudwatch:alarm", "value": "arn:aws:cloudwatch:eu-west-1:111122223333:alarm:staging-auth-success-below-99" } ],
  "roleArn": "arn:aws:iam::111122223333:role/fis-experiments"
}
~~~`,
  dia: r`flowchart LR
  SS[Define steady state metrics] --> H[Hypothesis]
  H --> EXP[Small experiment - staging first]
  EXP --> STOP{Stop condition breached?}
  STOP -->|yes| ABORT[Abort + learn]
  STOP -->|no| OBS[Observe vs hypothesis]
  OBS --> FIX[Fix weaknesses]
  FIX --> SCALE[Increase scope: prod low-traffic, AZ, region drills]`,
  pts: [r`Chaos engineering tests failure hypotheses against steady-state metrics.`, r`Start small with automatic stop conditions; grow scope gradually.`, r`Payment-relevant experiments: PSP failures, DB failover, AZ loss, latency, region drills.`, r`Avoid irreversible financial side effects; use sandboxes.`, r`Frame as regulatory resilience testing; involve risk and audit.`],
  ex: r`A latency-injection experiment showed a payments API's thread pool exhausted at 2-second PSP latency because its timeout was 30 seconds; fixing timeouts and the circuit breaker prevented a likely Black Friday outage.`,
  fu: [r`What would you never chaos-test in production?`, r`How do game days differ from chaos experiments?`],
  pit: [r`Starting with large production experiments.`, r`No automatic stop conditions.`, r`Running experiments that trigger real payments.`] },

{ id: 'q34', level: 'Senior', tags: ['finops', 'cost', 'tagging', 'infracost'],
  q: r`Bring cost into the DevOps loop: tagging and allocation, cost visibility in pull requests, budgets and anomaly detection, environment schedules, and making teams accountable without slowing them down.`,
  a: r`**Principle**: cost is a non-functional requirement owned by the teams that create it, with fast feedback — like performance or security.

**Allocation foundations**
- Account/subscription per workload and environment (natural cost boundaries).
- **Mandatory tags/labels** (owner, service, environment, cost-centre) enforced by policy at creation (Terraform policies, AWS tag policies/SCPs, Azure Policy, Kubernetes admission); untagged spend reported.
- Shared costs (networking, platform clusters, observability) allocated by agreed keys (usage, requests, headcount).

**Feedback in the workflow**
- **Cost estimates in PRs** (Infracost for Terraform): "this change adds about $1,240/month" before merge; thresholds requiring approval for large increases.
- Dashboards per team with unit cost (cost per transaction, per active customer) and trend.
- **Budgets and anomaly detection** (AWS Cost Anomaly Detection, Azure Cost Management alerts) routed to owning teams, not only finance.

**Common savings levers the pipeline can enforce**
- Environment schedules: non-prod off nights/weekends; ephemeral previews with TTLs.
- Right-sizing recommendations turned into PRs.
- Storage lifecycle policies and log retention defaults in modules.
- ARM/Graviton defaults, Spot for CI runners and batch.
- Avoid expensive defaults in modules (NAT per AZ for dev, provisioned IOPS everywhere).

**Accountability without friction**
- Showback first: teams see their costs and unit metrics monthly; chargeback only if the organisation needs it.
- Guardrails rather than approvals for most changes; human approval only for large increases.
- Celebrate savings; include cost in architecture decision records and postmortems (cost incidents: runaway jobs, logging explosions).
- FinOps champions per domain working with a central FinOps team on commitments (Savings Plans, reservations).`,
  code: r`~~~yaml
# GitHub Actions: Infracost comment on Terraform PRs; require approval above a threshold
- name: Infracost diff
  run: |
    infracost breakdown --path live/prod/eu-west-1/payments-db --format json --out-file /tmp/base.json
    infracost diff --path live/prod/eu-west-1/payments-db --compare-to /tmp/base.json --format json --out-file /tmp/diff.json
    infracost comment github --path /tmp/diff.json --repo $GITHUB_REPOSITORY --pull-request $PR_NUMBER \
      --github-token $GITHUB_TOKEN --behavior update
    DELTA=$(jq '.diffTotalMonthlyCost | tonumber' /tmp/diff.json)
    if [ "$(echo "$DELTA > 2000" | bc)" -eq 1 ]; then echo "::warning::Monthly cost increase above 2000 USD requires FinOps approval"; fi
~~~`,
  dia: r`flowchart LR
  PR[Terraform PR] --> IC[Infracost estimate in PR]
  IC -->|large increase| APPR[FinOps approval]
  IC -->|normal| MERGE[Merge]
  TAG[Tag policy at creation] --> ALLOC[Cost allocation by team/service]
  ALLOC --> DASH[Team dashboards: unit cost, trends]
  ANOM[Anomaly detection + budgets] --> TEAM[Owning team alerted]
  SCHED[Env schedules, TTLs, module defaults] --> SAVE[Savings by default]`,
  pts: [r`Cost is owned by the teams that create it, with fast feedback.`, r`Account boundaries plus enforced tags make allocation possible.`, r`Cost estimates in PRs; anomaly alerts to owning teams.`, r`Bake savings into modules and environment schedules.`, r`Showback, guardrails and celebration over heavy approvals.`],
  ex: r`Infracost comments flagged that a PR switching dev databases to Multi-AZ provisioned IOPS would add $18,000 a month; the team kept the setting for production only.`,
  fu: [r`How do you allocate shared Kubernetes cluster costs fairly?`, r`What is a cost incident, and how do you handle one?`],
  pit: [r`Cost visible only to finance, monthly.`, r`Untagged resources allowed.`, r`Expensive defaults in shared modules.`] },

{ id: 'q35', level: 'Senior', tags: ['iac-boundaries', 'gitops', 'ownership', 'kubernetes'],
  q: r`Where should Terraform stop and GitOps begin? Define ownership boundaries between cloud infrastructure, cluster add-ons and application manifests, and how to pass values (endpoints, identities, secrets) across the boundary.`,
  a: r`**The problem**: overlapping tools fight over the same resources (Terraform's Helm provider and Argo CD both managing an add-on; Terraform creating Kubernetes objects that GitOps prunes), causing drift loops, slow applies and unclear ownership.

**A common layered model**
| Layer | Tool | Owner | Examples |
|---|---|---|---|
| **Cloud foundations** | Terraform/OpenTofu (or Bicep/CDK) | platform/cloud team | accounts, VPCs, DNS zones, IAM, KMS, registries |
| **Cluster infrastructure** | Terraform | platform team | EKS/AKS cluster, node pools/Karpenter IAM, OIDC provider, cluster-level identities |
| **Cluster add-ons** | GitOps (Argo CD/Flux) from a platform repo | platform team | CNI config, ingress/gateway, cert-manager, external-secrets, policy engine, observability agents |
| **Application cloud dependencies** | Terraform modules per service (or Crossplane/ACK/ASO claims via GitOps) | service team via golden modules | databases, queues, buckets, IAM roles for workloads |
| **Application workloads** | GitOps | service teams | Deployments, Services, HPAs, Rollouts, config |

Rule: **each resource has exactly one owner tool**. Terraform should bootstrap GitOps (install Argo CD and point it at the platform repo) and then stop managing in-cluster objects.

**Passing values across the boundary**
- **Endpoints and IDs** (database endpoint, queue URL, IAM role ARN): Terraform writes outputs to a **parameter store** (SSM Parameter Store, Azure App Configuration, Key Vault) or to Kubernetes via External Secrets; apps read them at runtime; or Terraform outputs are committed to the GitOps repo by automation (PR) — avoid humans copying values.
- **Identities**: Terraform creates the IAM role / managed identity with trust for a specific Kubernetes service account; the GitOps manifest annotates the service account with the role ARN/client ID (value from the parameter store or a generated values file).
- **Secrets**: Terraform should not hold secret values; secrets live in the vault; External Secrets syncs them; IaC references names only.

**Crossplane/ACK/ASO alternative**: application cloud dependencies declared as Kubernetes resources in the same GitOps repo as the app — one workflow for teams, continuous reconciliation; requires a mature platform.`,
  code: r`~~~hcl
# Terraform (service module): create the queue and workload role, publish values for GitOps/apps
resource "aws_sqs_queue" "settlement" { name = "settlement-commands-prod" }

resource "aws_iam_role" "settlement_worker" {
  name               = "settlement-worker-prod"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_trust.json
}

resource "aws_ssm_parameter" "queue_url" {
  name  = "/prod/settlement/queue_url"
  type  = "String"
  value = aws_sqs_queue.settlement.url
}
resource "aws_eks_pod_identity_association" "worker" {
  cluster_name    = "prod-euw1"
  namespace       = "settlement"
  service_account = "settlement-worker"
  role_arn        = aws_iam_role.settlement_worker.arn
}
~~~
~~~yaml
# GitOps (app repo): consumes the value via External Secrets, no copy-paste
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata: { name: settlement-config, namespace: settlement }
spec:
  secretStoreRef: { kind: ClusterSecretStore, name: aws-parameter-store }
  target: { name: settlement-config }
  data: [ { secretKey: QUEUE_URL, remoteRef: { key: /prod/settlement/queue_url } } ]
~~~`,
  dia: r`flowchart TB
  TF1[Terraform: accounts, VPC, DNS, IAM] --> TF2[Terraform: cluster, node IAM, OIDC]
  TF2 -->|bootstraps| ARGO[Argo CD]
  ARGO --> ADDONS[Platform repo: add-ons]
  ARGO --> APPS[App repos: workloads]
  TF3[Terraform service modules: DB, queue, workload role] --> PS[(Parameter store / vault)]
  PS -->|External Secrets| APPS`,
  pts: [r`Each resource has exactly one owning tool.`, r`Terraform for cloud and cluster infrastructure; GitOps for add-ons and workloads.`, r`Terraform bootstraps GitOps, then stops managing in-cluster objects.`, r`Pass endpoints and identities via parameter stores and External Secrets, not copy-paste.`, r`Crossplane/ACK/ASO let teams declare cloud dependencies in GitOps.`],
  ex: r`A platform managed cert-manager with both Terraform's Helm provider and Argo CD; every apply and sync fought over versions. Moving add-ons entirely to Argo CD ended the drift loop.`,
  fu: [r`Who should own the database a service uses?`, r`How do you handle bootstrapping a brand-new cluster end to end?`],
  pit: [r`Two tools managing the same resource.`, r`Copying Terraform outputs into manifests by hand.`, r`Terraform holding secret values for apps.`] },

{ id: 'q36', level: 'Senior', tags: ['infrastructure-testing', 'terratest', 'terraform-test', 'validation'],
  q: r`Test infrastructure code: static checks, policy tests, terraform test, Terratest, ephemeral environments, and testing modules versus testing live stacks. What is worth testing?`,
  a: r`**Test pyramid for IaC**
| Level | Tools | Catches | Speed |
|---|---|---|---|
| **Formatting and validation** | {{terraform fmt -check}}, {{terraform validate}}, tflint (provider-aware rules) | syntax, invalid arguments, deprecated attributes, naming | seconds |
| **Static security/policy** | Checkov, Trivy (tfsec), KICS, Conftest/OPA on plan JSON | insecure configurations, standards violations | seconds-minutes |
| **Unit-style module tests** | {{terraform test}} with {{command = plan}} and mocked providers (newer versions) | module logic: variables, conditionals, outputs | fast |
| **Integration tests** | {{terraform test}} with {{command = apply}}, Terratest (Go), Kitchen-Terraform | real resources created correctly and work (connectivity, permissions) | minutes, costs money |
| **End-to-end / environment** | ephemeral environments built from the stack + application smoke tests | the whole system works together | slower |
| **Continuous verification** | drift detection, compliance scans, synthetic checks | production stays as designed | ongoing |

**What is worth testing**
- **Shared modules** (used by many teams): unit tests for logic, integration tests for critical behaviour (encryption on, backups configured, network reachability), policy tests — failures multiply across consumers.
- **Live stacks**: plan review + policy checks + drift detection; integration tests usually not needed for every stack.
- Security-critical properties (no public exposure, encryption, logging) — assert them explicitly.
- Upgrade paths: test that a new module version applied to an old one produces an expected plan (no unexpected replacements).

**Practicalities**: integration tests run in a dedicated sandbox account with automatic cleanup (nuke tools, TTL tags) and budget limits; parallelise with unique names; keep tests stable by avoiding eventual-consistency flakiness (retries/waits). Tests of policies themselves (OPA unit tests) are as important as tests of modules.`,
  code: r`~~~hcl
# modules/postgres/tests/defaults.tftest.hcl - fast plan-based test with assertions
variables {
  name           = "test-db"
  instance_class = "db.t4g.medium"
}

run "secure_defaults" {
  command = plan
  assert {
    condition     = aws_db_instance.this.storage_encrypted == true
    error_message = "Storage must be encrypted by default"
  }
  assert {
    condition     = aws_db_instance.this.publicly_accessible == false
    error_message = "Databases must never be publicly accessible"
  }
  assert {
    condition     = aws_db_instance.this.backup_retention_period >= 7
    error_message = "Backups must be retained at least 7 days"
  }
}

run "prod_requires_multi_az" {
  command   = plan
  variables { environment = "prod" }
  assert {
    condition     = aws_db_instance.this.multi_az == true
    error_message = "Production databases must be Multi-AZ"
  }
}
~~~
~~~bash
terraform fmt -check -recursive && terraform validate && tflint --recursive
terraform test -test-directory=tests            # module tests in CI
~~~`,
  dia: r`flowchart BT
  FMT[fmt / validate / tflint - seconds] --> POL[Checkov / Conftest policy - seconds]
  POL --> UNIT[terraform test plan-based - fast]
  UNIT --> INT[Integration: apply in sandbox, Terratest - minutes]
  INT --> E2E[Ephemeral environment + smoke tests]
  E2E --> CONT[Continuous: drift, compliance, synthetics]`,
  pts: [r`Layer IaC tests: validation, policy, unit, integration, end-to-end, continuous.`, r`Invest most in shared modules; live stacks rely on plan review, policy and drift detection.`, r`Assert security-critical properties explicitly.`, r`Test upgrade paths for unexpected replacements.`, r`Sandbox accounts with cleanup and budgets for integration tests.`],
  ex: r`A plan-based terraform test in the shared Postgres module caught a refactor that set publicly_accessible to true by default before 40 teams consumed the new version.`,
  fu: [r`How do you keep integration tests from leaving orphaned cloud resources?`, r`Should policies be tested like code?`],
  pit: [r`No tests for shared modules.`, r`Integration tests in production accounts.`, r`Untested policy code.`] },

{ id: 'q37', level: 'Principal', tags: ['transformation', 'roadmap', 'bank', 'leadership'],
  q: r`You join a bank that releases quarterly with weekend outages, manual testing, CAB approvals and click-ops infrastructure. Lay out a two-year DevOps transformation: sequencing, quick wins, organisational changes, risks, and how you measure success.`,
  a: r`**Start with diagnosis (first 6-8 weeks)**
- **Value stream mapping** for 2-3 representative products: where does time go between idea and production (waiting for environments, manual testing, CAB, release weekends)?
- Baseline **DORA metrics**, incident history, audit findings, engineer surveys.
- Map regulatory constraints with risk/compliance/audit — identify which controls are required and which are habits.

**Principles for sequencing**: prove value early with a few willing teams; build the paved road once, reuse it; change controls together with risk partners; avoid big-bang reorganisations.

**Phase 1 (months 0-6): foundations and lighthouse teams**
- Version control for everything, trunk-based development, CI on every commit for 2-3 lighthouse teams.
- Automated test suites at the right levels (unit, contract, integration with Testcontainers) to replace manual regression gradually.
- IaC for new environments; automated deployment to test environments; ephemeral environments where possible.
- Quick wins: remove weekend releases for one product via blue-green; automated change evidence pilot with audit.

**Phase 2 (months 6-12): paved road and controls**
- Platform team builds golden paths (templates, pipelines, IaC modules, observability defaults).
- Progressive delivery with automated analysis; pipeline deploys reclassified as **standard changes** with automated evidence (CAB only for high-risk normal changes).
- SLOs and error budgets for critical journeys; incident management process, blameless postmortems.
- Scale to 10-15 teams.

**Phase 3 (months 12-24): scale and optimise**
- Most teams on the paved road; legacy systems: strangler patterns, IaC adoption for existing infrastructure (import), database change automation.
- Team topology changes: stream-aligned teams owning services end to end (build and run), platform-as-product, enabling teams for test automation and SRE practices.
- FinOps, DevSecOps maturity, chaos/game days, DR automation.

**Risks**: treating it as a tools project; platform team becoming a ticket queue; middle-management incentives tied to old metrics; regulators surprised by changes (engage early); legacy systems excluded and becoming the bottleneck; change fatigue.

**Success measures**: DORA metrics per product (target: weekly → daily deployments for modern services, change failure rate below 10%, recovery under an hour), audit findings trend, engineer satisfaction, time to onboard a new service, incident trends, business outcomes (time-to-market for features, cost per transaction).`,
  code: r`~~~text
Transformation scorecard (quarterly, per product)
Metric                         Baseline   Q2       Q4       Q8 target
Deployment frequency           quarterly  monthly  weekly   daily (modern services)
Lead time for changes          90 days    30 days  7 days   < 2 days
Change failure rate            25%        20%      12%      < 10%
Recovery time                  8 h        4 h      1.5 h    < 1 h
Weekend release hours/quarter  48         24       4        0
Manual regression test days    15         10       3        < 1
Audit findings (change mgmt)   7          5        2        0
Engineer satisfaction (eNPS)   -20        -5       +10      +20
~~~`,
  dia: r`flowchart LR
  D[Diagnose: value streams, DORA baseline, controls map] --> P1[Phase 1: lighthouse teams, CI, tests, IaC]
  P1 --> P2[Phase 2: paved road, standard changes, SLOs]
  P2 --> P3[Phase 3: scale, team topologies, legacy strangling]
  RISK[Risk + audit partnership] -.throughout.-> P1
  RISK -.-> P2
  MET[Quarterly scorecard] -.feedback.-> P1
  MET -.-> P3`,
  pts: [r`Diagnose with value stream mapping, baselines and a controls map.`, r`Prove value with lighthouse teams before scaling.`, r`Build a paved road and change controls with risk and audit.`, r`Evolve team topologies and include legacy systems.`, r`Measure DORA, audit findings, satisfaction and business outcomes quarterly.`],
  ex: r`A retail bank moved its mortgage platform from quarterly weekend releases to weekly daytime deployments in 14 months, with zero change-management audit findings, by co-designing automated evidence with internal audit.`,
  fu: [r`How do you choose lighthouse teams?`, r`What would you do if the platform team becomes a bottleneck?`],
  pit: [r`Starting with a tool purchase.`, r`Ignoring risk and audit until the end.`, r`Big-bang reorganisation before proving practices.`] },

{ id: 'q38', level: 'Principal', tags: ['platform-engineering', 'idp', 'platform-as-product'],
  q: r`Make the case for and design a platform engineering function: thinnest viable platform, platform as a product, what to build versus buy, how to fund it, and how to avoid it becoming a bottleneck or an ivory tower.`,
  a: r`**Why a platform**: as organisations grow, every stream-aligned team reinventing pipelines, IaC, observability, security controls and environments wastes effort and creates inconsistent risk. A platform provides **self-service capabilities with guardrails** that reduce cognitive load and make the compliant path the easiest path.

**Thinnest viable platform (TVP)**: start with the smallest set of capabilities that removes the biggest pain — often a documented golden path (templates, pipeline, deployment target, observability defaults). Grow based on demand, not ambition. Sometimes the TVP is a wiki page plus a few templates; later an internal developer portal.

**Platform as a product**
- **Users**: application teams; **product manager** for the platform; roadmap driven by user research, adoption and outcome metrics.
- **Interfaces**: APIs, CLIs, templates, portal; documentation and examples; versioning and deprecation policies.
- **SLOs** for platform capabilities (CI availability, deployment success, provisioning time).
- **Optional adoption** in principle — if teams avoid the platform, it is not good enough; mandate only for compliance-critical controls.

**Build vs buy**: buy or use managed services for undifferentiated capabilities (CI/CD SaaS, managed Kubernetes or container services, observability SaaS, secrets managers, feature flag services, portals like Backstage-based offerings); build the glue that encodes your standards (golden templates, policies, integrations with your identity, compliance evidence). Avoid building your own CI system, container orchestrator or secret store.

**Funding**: central funding (platform is infrastructure), measured by value delivered (time saved, incidents avoided, audit effort reduced, onboarding time) — showback of platform costs to consumers can inform but should not discourage adoption.

**Avoiding failure modes**
- **Bottleneck** (ticket queue): self-service APIs instead of requests; clear contribution model (inner source) so teams can extend the platform.
- **Ivory tower**: embedded engineers, regular user interviews, dogfooding, measure adoption and satisfaction.
- **Over-abstraction**: escape hatches for advanced teams.
- **Under-investment**: platform teams sized and staffed like product teams, not as a side job.`,
  code: r`~~~text
Platform product canvas (excerpt)
Users: 40 stream-aligned teams (.NET APIs, Angular/React frontends, data pipelines)
Top pains (survey + VSM): environment provisioning 3-10 days; inconsistent pipelines; audit evidence by hand
TVP v1 (quarter 1): service template + reusable pipeline + container platform target + OTel defaults
Metrics: time to first prod deploy (target < 1 day), golden path adoption (target 70% in 12 months),
         platform NPS, CI p95 duration < 15 min, deployment success rate > 99%
Build: templates, policies, compliance evidence integration, portal plugins
Buy/managed: CI SaaS runners, managed Kubernetes/container service, observability SaaS, secrets manager
Contribution model: inner source, RFCs, platform office hours
~~~`,
  dia: r`flowchart LR
  USERS[Stream-aligned teams] -->|self-service| PORTAL[Portal / CLI / templates]
  PORTAL --> CAP[Capabilities: pipelines, environments, data stores, observability, secrets]
  CAP --> MANAGED[Managed services bought]
  CAP --> GLUE[Glue built: policies, evidence, templates]
  USERS -.feedback, contributions.-> PT[Platform team as product: PM, roadmap, SLOs]
  PT --> CAP`,
  pts: [r`Platforms reduce cognitive load with self-service and guardrails.`, r`Start with a thinnest viable platform; grow by demand.`, r`Run it as a product: PM, roadmap, SLOs, user research.`, r`Buy undifferentiated capabilities; build the glue encoding standards.`, r`Avoid bottlenecks, ivory towers and over-abstraction.`],
  ex: r`A bank's platform team began with one golden path for .NET APIs; adoption reached 75% in a year because teams chose it, and it cut audit evidence work for change management by 90%.`,
  fu: [r`How do you decide what the platform should not do?`, r`Should platform adoption be mandatory?`],
  pit: [r`Building a huge platform before validating needs.`, r`Platform as a ticket queue.`, r`Building commodity tools in-house.`] },

{ id: 'q39', level: 'Principal', tags: ['team-topologies', 'cognitive-load', 'ownership', 'org-design'],
  q: r`Apply Team Topologies to a 300-engineer organisation: team types, interaction modes, cognitive load, ownership boundaries aligned with architecture (Conway's law), and how you move from component teams to stream-aligned teams.`,
  a: r`**Team types**
- **Stream-aligned**: aligned to a flow of business change (payments acceptance, onboarding, cards); own services end to end (build, run, improve). Most teams should be this type.
- **Platform**: provide internal services that reduce stream-aligned teams' cognitive load (delivery platform, data platform).
- **Enabling**: specialists who help teams acquire capabilities (test automation, SRE practices, security) and then move on — they do not do the work permanently.
- **Complicated-subsystem**: own components requiring deep specialist knowledge (pricing engine, fraud models, matching engine).

**Interaction modes**: **collaboration** (time-boxed, discovering something new together), **X-as-a-Service** (clear API, minimal coordination — the target for platform consumption), **facilitating** (enabling teams coaching).

**Cognitive load**: teams can own only so much — intrinsic (domain complexity), extraneous (tooling friction, unclear processes) and germane (learning the domain). Reduce extraneous load with platforms; size service ownership so a team of 5-9 can operate it well (on-call, understanding).

**Conway's law and the inverse manoeuvre**: systems mirror communication structures. If you want independently deployable services by business capability, organise teams around those capabilities and give them ownership of their data and deployments. Shared databases or shared "integration teams" re-create coupling.

**From component teams to stream-aligned teams**
1. Map value streams and current architecture/ownership (who must coordinate to deliver a typical change?).
2. Define target streams and the services each stream will own; identify platform and complicated-subsystem needs.
3. Move incrementally: form one or two stream-aligned teams with clear ownership, give them a platform to stand on, measure lead time and dependencies.
4. Re-architect boundaries where needed (strangle shared components into owned services, split shared databases).
5. Adjust on-call, budgets and metrics to the new ownership; managers support with career paths for specialists.

**Pitfalls**: reorgs without architectural change (teams still blocked by shared components), too many platform layers, enabling teams becoming permanent dependencies, and ignoring the human side (skills, roles, incentives).`,
  code: r`~~~text
Target team map (excerpt)
Stream-aligned:  Card Acceptance | Payouts | Merchant Onboarding | Disputes | Customer Portal (Angular)
Platform:        Delivery Platform (CI/CD, containers, IaC modules) | Data Platform (Kafka, warehouse) | Identity Platform
Complicated:     Fraud Scoring Engine | FX Pricing Engine
Enabling:        SRE Practices (rotates: 1 quarter per team) | Test Automation Guild | Security Champions
Interactions:    Card Acceptance <-> Fraud Scoring: collaboration (Q1, new model API), then X-as-a-Service
                 All stream teams -> Delivery Platform: X-as-a-Service
Dependency metric: % changes requiring > 1 team to ship (baseline 46%, target < 15%)
~~~`,
  dia: r`flowchart LR
  SA1[Stream: Card Acceptance] -->|X-as-a-Service| PLAT[Delivery Platform]
  SA2[Stream: Payouts] -->|X-as-a-Service| PLAT
  SA1 -->|collaboration then XaaS| CS[Complicated subsystem: Fraud Engine]
  EN[Enabling: SRE practices] -->|facilitating| SA1
  EN -->|facilitating| SA2
  SA1 --> SVC1[Owns services + data + on-call]`,
  pts: [r`Four team types: stream-aligned, platform, enabling, complicated-subsystem.`, r`Interaction modes: collaboration, X-as-a-Service, facilitating.`, r`Manage cognitive load; platforms remove extraneous load.`, r`Use the inverse Conway manoeuvre: align teams and architecture.`, r`Move incrementally, re-architect boundaries, and align incentives and on-call.`],
  ex: r`A payments organisation measured that 46% of changes needed more than one team; reorganising into stream-aligned teams with owned services and a delivery platform cut it to 12% and halved lead time.`,
  fu: [r`What is the right size for a stream-aligned team's scope?`, r`How do you handle a shared legacy database during the transition?`],
  pit: [r`Reorganising without changing architecture.`, r`Permanent enabling teams doing the work.`, r`Ignoring cognitive load when assigning services.`] },

{ id: 'q40', level: 'Principal', tags: ['compliance', 'sox', 'pci', 'dora-regulation', 'automation'],
  q: r`Design "compliance as code" for a regulated firm: map SOX ITGC, PCI DSS and DORA requirements to automated controls in the delivery system, produce continuous evidence, and work with auditors and regulators.`,
  a: r`**Mindset**: regulators and auditors specify **control objectives**; they rarely mandate specific manual processes. Automated, consistently enforced controls with system-generated evidence are usually stronger than manual sign-offs.

**Mapping examples**
| Requirement | Control objective | Automated implementation | Evidence |
|---|---|---|---|
| SOX ITGC change management | authorised, tested, segregated changes | branch protection, required reviewers ≠ author, CI tests, environment approvals for prod, deploy only via pipeline | PR + approvals, test results, deploy logs linked to change records |
| SOX ITGC logical access | least privilege, timely removal, reviews | SSO groups, JIT production access (PIM), automated joiner/mover/leaver, quarterly access reviews | access logs, review records |
| PCI DSS 6 (secure development) | secure coding, vulnerability management | SAST/SCA gates, image scanning, patch SLAs, golden images | scan reports, remediation metrics |
| PCI DSS 10 (logging) | audit trails, retention, review | central log pipelines, immutable storage, SIEM alerts | log retention config, alert evidence |
| PCI DSS 1/2 (network, config standards) | segmentation, hardening | IaC + policy as code, CIS benchmarks, admission policies | policy reports, drift detection |
| DORA (EU) ICT risk, change, resilience testing, incident reporting, third-party risk | managed ICT change, tested resilience, timely incident reports | progressive delivery, DR drills and chaos tests, incident classification workflow, vendor inventory | drill reports, incident records, register of third-party arrangements |

**Continuous evidence architecture**
- Every control emits events (pipeline, IaC, access, scanning, incidents) to an evidence store (warehouse or GRC tool) keyed by system and time.
- Dashboards show control health continuously; auditors sample directly from the system.
- Controls are versioned (policy as code), tested and reviewed like software.

**Working with auditors and regulators**
- Involve internal audit early in design; walk through the control and evidence model; run a pilot audit on one product.
- Document control descriptions in plain language with links to implementation.
- Keep exceptions explicit (time-bound, approved).
- For regulators: show testing of resilience and incident processes, not just policies.

**Benefits**: faster delivery and better compliance simultaneously; audits become cheaper; fewer findings caused by inconsistent manual steps.`,
  code: r`~~~json
// Evidence event emitted by the deployment pipeline (stored in the evidence warehouse)
{
  "control": "SOX-CM-01",
  "system": "payments-api",
  "environment": "prod",
  "change_id": "CHG0048211",
  "pr": { "url": "https://git.bank.example/payments-api/pull/1842", "author": "dev-a", "approvers": ["dev-b"], "author_is_approver": false },
  "tests": { "unit": "passed", "integration": "passed", "report": "https://ci.bank.example/runs/48211/tests" },
  "security": { "sast_new_high": 0, "image_critical_fixable": 0 },
  "deployment": { "strategy": "canary", "digest": "sha256:9c1e...", "started": "2026-10-11T08:58:12Z", "result": "success" },
  "approval_env": { "name": "prod", "approved_by": "release-mgr-c" }
}
~~~`,
  dia: r`flowchart LR
  REQ[Regulatory requirements] --> OBJ[Control objectives]
  OBJ --> CTRL[Automated controls: branch protection, gates, policies, JIT access]
  CTRL --> EVT[Evidence events]
  EVT --> STORE[(Evidence store / GRC)]
  STORE --> DASH[Continuous control dashboards]
  DASH --> AUD[Auditors sample from system]
  AUD -.feedback.-> CTRL`,
  pts: [r`Regulators set control objectives; automation can meet them better than manual steps.`, r`Map SOX, PCI DSS and DORA requirements to concrete automated controls.`, r`Emit evidence events into a store; dashboards show control health continuously.`, r`Version and test controls as code; keep exceptions explicit.`, r`Involve auditors early and pilot.`],
  ex: r`An asset manager replaced quarterly evidence collection (6 weeks of work across teams) with pipeline evidence events; the next SOX audit sampled 40 changes in a day with no findings.`,
  fu: [r`How do you prove segregation of duties when a team has two engineers?`, r`What does DORA add beyond existing ICT controls?`],
  pit: [r`Automating deployments but keeping manual evidence spreadsheets.`, r`Designing controls without audit involvement.`, r`Undocumented exceptions.`] },

{ id: 'q41', level: 'Principal', tags: ['iac-architecture', 'multi-cloud', 'repository-layout', 'promotion'],
  q: r`Design the IaC architecture for a multi-region, multi-account (and partly multi-cloud) estate: repository and state layout, module catalogue, promotion of infrastructure changes through environments, ownership, and governance.`,
  a: r`**Layers and ownership**
1. **Organisation/foundation** (cloud org structure, guardrails, identity federation, logging accounts) — cloud platform team; changes rare, highest scrutiny.
2. **Shared network and connectivity** (transit hubs, DNS, egress, on-prem links) — network team.
3. **Shared platforms** (Kubernetes clusters, registries, observability, secrets managers) — platform team.
4. **Workload infrastructure** (databases, queues, buckets, service identities) — service teams, using golden modules.

**Repositories**
- **Module catalogue repo(s)**: versioned modules per cloud (AWS/Azure) with tests, docs, examples, semantic versions, and a changelog; published to a private registry.
- **Live repos per layer** (foundation, network, platform) owned by those teams; workload infrastructure either in each service repo ({{infra/}} next to the code — co-ownership with the app) or in team-level live repos.
- **Policy repo**: shared policy-as-code bundles consumed by all pipelines.

**State layout**: one state per (layer, account/subscription, region, component); naming convention encodes it; separate backends/credentials per environment account. Cross-state values via parameter stores or remote state with stable outputs.

**Promotion of infrastructure changes**
- Module changes: release module version → applied to dev stacks automatically (Renovate PRs) → staging → production (PR per environment), with plan review and policy checks at each step.
- Live-stack changes: same PR flow through environments; production applies only via CI with approval; canary stacks for broad changes (one region/account first).
- Breaking changes require migration guides and {{moved}} blocks.

**Multi-cloud specifics**: separate modules per cloud (do not abstract clouds behind a lowest-common-denominator module); shared conventions (naming, tagging, policies expressed per cloud); Terraform/OpenTofu as the common language, native tools where justified (Bicep for Azure landing zones).

**Governance**: CODEOWNERS per layer; policies enforced in pipelines and at the cloud level; drift detection; quarterly review of module adoption and versions; deprecation policy (modules older than N versions flagged).`,
  code: r`~~~text
repos/
  iac-modules-aws/         modules/{vpc,eks,rds-postgres,sqs,iam-workload-role}  (semver, tests, registry)
  iac-modules-azure/       modules/{vnet,aks,sql-db,servicebus,managed-identity}
  iac-policies/            rego/, checkov/, tests/
  live-foundation/         aws/org/, azure/mgmt-groups/              (owner: cloud-platform, 2 approvals)
  live-network/            aws/{prod,nonprod}/{eu-west-1,eu-central-1}/transit/   (owner: network)
  live-platform/           aws/prod/eu-west-1/eks-prod-shared/      (owner: platform)
  payments-api/infra/      prod/eu-west-1/{db,queues,iam}/           (owner: payments team, module consumers)
State key convention: <layer>/<cloud>/<account>/<region>/<component>/terraform.tfstate
~~~`,
  dia: r`flowchart TB
  MODS[Module catalogue - versioned, tested] --> F[Foundation live repo]
  MODS --> N[Network live repo]
  MODS --> P[Platform live repo]
  MODS --> S[Service repos infra/]
  POL[Policy bundles] --> PIPE[Pipelines: plan, policy, approval, apply]
  F --> PIPE
  N --> PIPE
  P --> PIPE
  S --> PIPE
  PIPE --> DEV[Dev accounts] --> STG[Staging] --> PRD[Prod - canary region first]`,
  pts: [r`Layer IaC by ownership: foundation, network, platform, workloads.`, r`Versioned module catalogues per cloud; live repos per layer; shared policy repo.`, r`One state per layer, account, region and component.`, r`Promote module versions and changes through environments with canary stacks.`, r`Per-cloud modules, CODEOWNERS, drift detection and deprecation policies.`],
  ex: r`A bank's move to layered repos with a versioned module catalogue let it roll a new encryption standard across 600 stacks via automated PRs in six weeks, canarying in one region first.`,
  fu: [r`Should workload infrastructure live with the application code?`, r`How do you stop modules fragmenting into many forks?`],
  pit: [r`One monolithic repo and state for everything.`, r`Lowest-common-denominator multi-cloud modules.`, r`No canary for broad infrastructure changes.`] },

{ id: 'q42', level: 'Principal', tags: ['reliability-strategy', 'slos', 'investment', 'governance'],
  q: r`Set a reliability strategy across an organisation: tiering services, setting SLOs top-down and bottom-up, aligning error budgets with roadmaps, deciding where to invest (multi-region, redundancy, people), and reporting reliability to executives.`,
  a: r`**Tier services by business impact**
| Tier | Example | Target SLO | Expectations |
|---|---|---|---|
| **Tier 0** | card authorisation, payments core, login | 99.95-99.99% | multi-AZ static stability, tested DR (warm standby), 24/7 on-call, progressive delivery mandatory |
| **Tier 1** | account overview, transfers scheduling | 99.9% | multi-AZ, DR within hours, on-call |
| **Tier 2** | reporting, internal tools | 99.5% | business-hours support, backup/restore DR |

**Setting SLOs**
- **Top-down**: from customer journeys and business/regulatory impact tolerances (how long can payments be down before harm?) — operational resilience regimes (PRA/FCA impact tolerances, DORA) push this explicitly.
- **Bottom-up**: from current performance and dependency limits (your SLO cannot exceed what dependencies allow without redundancy).
- Reconcile: gaps become investment cases.

**Investment decisions**: each "nine" costs more. Compare options per tier with cost and risk reduction:
- Improve change safety (canaries, rollbacks) — often the cheapest large win since most incidents follow changes.
- Remove single points of failure, timeouts/circuit breakers, capacity headroom.
- Multi-region active-passive or active-active only where impact tolerances demand it.
- People and process: on-call quality, incident response training, game days.
Use incident data (causes, durations, customer impact) to prioritise.

**Aligning with roadmaps**: error budget status in quarterly planning; reliability epics compete transparently with features; policies pre-agreed (q24).

**Executive reporting**
- Per tier and customer journey: SLO attainment, budget consumed, major incidents with customer impact and root themes, trend.
- Risk view: top reliability risks with planned mitigations and dates.
- Avoid vanity metrics (overall "uptime" averaged across everything, number of alerts).`,
  code: r`~~~text
Executive reliability report - Q3 (excerpt)
Journey                 Tier  SLO      Attained   Budget used  Major incidents  Top theme
Card authorisation      0     99.95%   99.97%     61%          1 (PSP timeout)  dependency resilience
Customer login          0     99.95%   99.92%     160%         2                config changes
Payments to beneficiary 1     99.9%    99.96%     40%          0                -
Statements              2     99.5%    99.8%      40%          0                -
Top risks: login config changes without canary (mitigation: config canary, due Q4);
           single PSP for EU cards (mitigation: secondary PSP failover, due Q1)
~~~`,
  dia: r`flowchart LR
  BIZ[Impact tolerances + customer journeys] --> SLO[SLOs per tier]
  DATA[Current performance + dependencies] --> SLO
  SLO --> GAP{Gap?}
  GAP -->|yes| INV[Investment cases: change safety, SPOFs, multi-region, people]
  GAP -->|no| KEEP[Maintain, avoid over-engineering]
  SLO --> EB[Error budgets in planning]
  SLO --> EXEC[Executive reporting by journey + risks]`,
  pts: [r`Tier services by business impact with matching expectations.`, r`Set SLOs top-down from impact tolerances and bottom-up from data.`, r`Invest where gaps exist; change safety is often the cheapest win.`, r`Error budgets inform roadmaps.`, r`Report by journey with risks and themes, not averaged uptime.`],
  ex: r`Incident analysis showed 70% of a bank's tier-0 downtime came from changes rather than infrastructure failures; investing in canaries and config validation improved availability more than a planned active-active project would have.`,
  fu: [r`How do you decide a service needs active-active multi-region?`, r`How do operational resilience regulations change SLO setting?`],
  pit: [r`Same SLO for every service.`, r`Buying redundancy while ignoring change-related incidents.`, r`Reporting a single averaged uptime number.`] },

{ id: 'q43', level: 'Principal', tags: ['major-incidents', 'regulatory-reporting', 'communication', 'dora-regulation'],
  q: r`Design the major incident process for a bank operating in the EU and UK: classification, command structure across teams and vendors, customer and executive communication, regulatory notification timelines, and learning at organisational level.`,
  a: r`**Classification**: a major incident framework aligned with regulatory criteria — DORA's criteria for major ICT-related incidents (clients affected, duration, geographic spread, data losses, criticality of services, economic impact), PSD2/payment scheme rules, and UK operational resilience (impact tolerance breaches for important business services). Classification decisions are made early by a designated role (with compliance) and revisited as facts change.

**Command structure**
- **Incident commander** (rota of senior engineers/managers trained in incident command).
- Technical leads per affected domain; **vendor liaison** (cloud provider, PSP, core banking vendor) with escalation contacts and support contracts known in advance.
- **Communications lead** (internal, customers, status page), **business liaison** (operations, contact centres), **compliance/regulatory liaison**, **scribe**.
- Clear decision rights: failover to DR, disabling products, customer communications approval.

**Communication**
- Customers: status page and app banners with honest impact and next update time; contact centre scripts.
- Executives: regular briefings (impact, actions, ETA, regulatory status).
- Partners and schemes as contractually required.

**Regulatory notification** (know the timelines before you need them)
- **DORA** (in force since January 2025): initial notification of a major ICT-related incident within **4 hours of classification** (and no later than 24 hours from becoming aware), an intermediate report within 72 hours, and a final report within about one month — per the technical standards; verify current requirements with compliance.
- UK: notify the FCA/PRA promptly for material operational incidents per their rules; operational resilience self-assessments track impact tolerance breaches.
- Data breaches: GDPR notification to the supervisory authority within 72 hours where required.
- Pre-approved templates and a regulatory liaison reduce errors under pressure.

**Learning at organisational level**
- Postmortems for all major incidents, reviewed by senior leadership; cross-cutting themes analysed quarterly.
- Incident simulations (including regulatory reporting exercises and vendor outages) at least annually.
- Track action completion; feed themes into reliability strategy and budgets.`,
  code: r`~~~text
Major incident runbook - first hour checklist
[ ] T+0   Incident declared, IC assigned, bridge + channel opened, scribe started timeline
[ ] T+10  Impact assessed: services, customers, geographies, payments volume affected
[ ] T+15  Mitigation options decided (rollback / failover / disable feature) - decision logged
[ ] T+20  Status page + app banner published; contact centre script issued
[ ] T+30  Compliance liaison: classification against DORA major-incident criteria + UK rules
[ ] T+30  Vendor escalations opened (cloud, PSP) with severity and contract references
[ ] T+45  Executive briefing #1
[ ] Classification time recorded -> DORA initial notification due within 4 h of classification
[ ] Every 30 min: customer + exec updates until resolved
~~~`,
  dia: r`flowchart TB
  DET[Detection] --> DECL[Declare major incident]
  DECL --> IC[Incident commander]
  IC --> TECH[Technical leads per domain]
  IC --> VEND[Vendor liaison]
  IC --> COMMS[Comms: customers, status page, execs]
  IC --> REG[Compliance: classification + regulatory notifications]
  REG --> N4[DORA initial notification within 4 h of classification]
  IC --> SCRIBE[Scribe timeline]
  SCRIBE --> PM[Postmortem + org-level themes]`,
  pts: [r`Classify early against regulatory criteria with compliance involvement.`, r`Command structure with IC, technical leads, vendor, comms, business and regulatory liaisons.`, r`Honest, regular communication to customers and executives.`, r`Know notification timelines: DORA initial report within 4 hours of classification, GDPR 72 hours.`, r`Organisation-level learning through reviewed postmortems, themes and simulations.`],
  ex: r`During a PSP outage a bank's practised process produced its DORA initial notification 2 hours after classification using a pre-approved template, while the IC kept engineers focused on failing over to a secondary PSP.`,
  fu: [r`Who should have authority to fail over a tier-0 service to DR?`, r`How do you rehearse regulatory reporting?`],
  pit: [r`Discovering notification timelines during the incident.`, r`Engineers drafting regulatory reports mid-incident.`, r`No vendor escalation paths prepared.`] },

{ id: 'q44', level: 'Principal', tags: ['build-vs-buy', 'tooling', 'vendor-strategy'],
  q: r`Decide the DevOps toolchain strategy for a 300-engineer firm: GitHub versus GitLab versus Azure DevOps, managed versus self-hosted runners, Terraform Cloud versus self-managed, observability SaaS versus open source, feature flag vendors — with a decision framework rather than preferences.`,
  a: r`**Decision framework**
1. **Requirements**: security and compliance (SSO, audit logs, data residency, segregation of duties, evidence export), integration (identity, ITSM, cloud providers), scale (repos, minutes, users), developer experience, reliability/SLA, support.
2. **Total cost of ownership**: licences + infrastructure + **people to operate** (self-hosted CI, observability stacks and secrets platforms need dedicated engineers and on-call) + migration cost + opportunity cost.
3. **Strategic fit**: existing investments (Microsoft enterprise agreement, cloud provider), skills, vendor viability, lock-in and exit cost (data export, open formats such as OpenTelemetry, OCI, Git).
4. **Risk**: concentration risk (DORA third-party risk management: critical providers need exit strategies), vendor security posture, licence changes (as seen with Terraform's BSL).

**Typical conclusions (context-dependent)**
- **Source control and CI**: consolidate on one platform (GitHub Enterprise or GitLab or Azure DevOps) for consistent controls; GitHub for ecosystem and Actions, GitLab for integrated DevSecOps and self-managed options, Azure DevOps where Boards/Microsoft integration dominate.
- **Runners**: managed/hosted runners for most work; self-hosted ephemeral runners in your network for private connectivity, data residency or special hardware — operated as a platform service.
- **IaC orchestration**: start with pipelines (Atlantis/GitHub Actions) and add Terraform Cloud/Spacelift when governance, policy and run history at scale justify cost; consider OpenTofu for licensing reasons.
- **Observability**: OpenTelemetry instrumentation everywhere (vendor-neutral), then choose backend by cost and operations: SaaS (Datadog, New Relic, Grafana Cloud, Honeycomb) for speed, self-hosted (Prometheus/Grafana/Loki/Tempo) where cost at scale or data residency justify a team to run it.
- **Feature flags**: buy (LaunchDarkly, Flagsmith, cloud config services) via OpenFeature to limit lock-in; build only if requirements are trivial.

**Process**: requirements matrix, shortlist, time-boxed proofs of concept with real teams, security and procurement review, decision record (ADR) with revisit triggers and exit plan.`,
  code: r`~~~text
Tool selection matrix (weights sum to 100) - CI/CD platform
Criterion                          Weight  GitHub Ent.  GitLab Ultimate  Azure DevOps
Security/compliance (SSO, audit)     20        4             5               4
Segregation of duties + evidence     15        4             4               4
Developer experience / ecosystem     15        5             4               3
Integration (Entra ID, ServiceNow)   10        4             4               5
Self-hosted / residency options      10        3             5               3
TCO (licences + ops people)          15        4             3               4
Exit cost / open formats             15        4             4               3
Weighted score                                 4.10          4.10            3.65
Tie-break: PoC with 3 teams (lead time, satisfaction), existing Microsoft agreement, runner strategy
~~~`,
  dia: r`flowchart LR
  REQ[Requirements: security, compliance, integration, scale] --> SHORT[Shortlist]
  TCO[TCO incl. people to operate] --> SHORT
  RISK[Vendor + concentration + licence risk] --> SHORT
  SHORT --> POC[Time-boxed PoCs with real teams]
  POC --> ADR[ADR + exit plan + revisit triggers]
  OTEL[Open standards: Git, OCI, OpenTelemetry, OpenFeature] -.reduce lock-in.-> ADR`,
  pts: [r`Decide with requirements, TCO including operators, strategic fit and risk.`, r`Consolidate source control/CI for consistent controls.`, r`Prefer managed services; self-host only for clear reasons and staff it.`, r`Use open standards (OpenTelemetry, OCI, OpenFeature) to reduce lock-in.`, r`Run PoCs and record ADRs with exit plans.`],
  ex: r`A firm self-hosting Jenkins, Nexus and ELK spent six engineers on tooling operations; consolidating on a managed CI platform and observability SaaS with OpenTelemetry freed four engineers for golden-path work at similar total cost.`,
  fu: [r`When is self-hosted observability cheaper than SaaS?`, r`How do DORA third-party risk rules affect toolchain choices?`],
  pit: [r`Choosing by engineer preference or demo polish.`, r`Ignoring the people cost of self-hosting.`, r`No exit plan for critical vendors.`] },

{ id: 'q45', level: 'Principal', tags: ['engineering-productivity', 'space', 'devex', 'metrics'],
  q: r`Leadership wants to "measure developer productivity". How do you approach it responsibly using DORA, SPACE and developer experience research, which metrics you would and would not use, and how you turn measurement into improvement?`,
  a: r`**Reframe the question**: productivity of a software organisation is about delivering valuable outcomes sustainably — not output per individual. Measure **systems and teams**, and use metrics to find constraints, not to rank people.

**Frameworks**
- **DORA**: delivery throughput and stability (q2) — system-level, well researched.
- **SPACE**: Satisfaction and well-being, Performance (outcomes), Activity, Communication and collaboration, Efficiency and flow — use several dimensions together; no single metric.
- **Developer experience (DevEx)**: feedback loops (build/test/review times), cognitive load, flow state (uninterrupted time) — measured via surveys plus system data.

**Useful metrics (team/system level)**
- DORA metrics; PR cycle time broken into segments (time to first review, rework, waiting to deploy).
- CI duration and reliability (flaky test rate), local build times, environment provisioning time.
- Time to first PR for new joiners; time to create a new service.
- Developer survey scores (satisfaction, perceived obstacles, focus time), regularly.
- Outcome measures: customer adoption, incident impact, business KPIs for delivered features.

**Metrics to avoid**
- Lines of code, commits, story points velocity comparisons, individual PR counts, hours online — easily gamed and harmful to collaboration, quality and trust.
- AI-assisted "code generated" volume as a productivity measure.

**Turning measurement into improvement**
1. Share metrics with teams first; teams identify their constraints (slow reviews, flaky tests, approvals, environment waits).
2. Invest in fixing systemic constraints (platform improvements, test reliability, removing approval steps) — leadership's role is to fund and remove blockers.
3. Run experiments with before/after measurement.
4. Report to leadership at an aggregate level with narrative: what we learned, what we changed, impact.

**Governance**: written principles (no individual performance use, transparency, privacy), involvement of engineering managers and employee representatives where required.`,
  code: r`~~~text
Developer experience quarterly report (organisation level)
Signal                                  Q2        Q3        Change   Action taken
Median PR time to first review          19 h      7 h       -63%     review rota + smaller PRs guidance
CI p90 duration                         31 min    14 min    -55%     remote cache, test sharding
Flaky test rate                         4.2%      1.1%      -74%     quarantine + ownership
Time to first PR (new joiners)          9 days    2 days    -78%     devcontainers + templates
Survey: "I can focus without interruption" 41%    58%       +17pp    on-call load reduction, meeting-free mornings
Deployment frequency (median team)      2/week    5/week
Change failure rate                     13%       9%
~~~`,
  dia: r`flowchart LR
  SYS[System data: Git, CI, CD, incidents] --> M[Team-level metrics: DORA, cycle time segments, CI health]
  SURV[Developer surveys: satisfaction, focus, friction] --> M
  M --> TEAMS[Teams identify constraints]
  TEAMS --> INV[Leadership funds fixes: platform, tests, approvals]
  INV --> EXP[Experiments + before/after]
  EXP --> M
  BAD[LOC, commits, velocity rankings] -.excluded.-> M`,
  pts: [r`Measure teams and systems, not individuals.`, r`Combine DORA, SPACE dimensions and developer experience signals.`, r`Use cycle time segments, CI health, onboarding time and surveys.`, r`Avoid lines of code, commit counts and velocity comparisons.`, r`Use metrics to find and fund fixes for constraints.`],
  ex: r`Segmenting PR cycle time showed most delay was waiting for review, not coding; a review rota and smaller-PR norms cut lead time by 40% — something no individual activity metric would have revealed.`,
  fu: [r`How would you respond if asked to identify the bottom 10% of engineers using these metrics?`, r`How do you measure the impact of AI coding assistants responsibly?`],
  pit: [r`Individual productivity rankings.`, r`Single-metric targets.`, r`Measuring without acting on findings.`] },

{ id: 'q46', level: 'Principal', tags: ['architecture-review', 'anti-patterns', 'devops-assessment'],
  q: r`Assess this setup and give a prioritised remediation plan: production deployed by an operations engineer via RDP and manual file copy on Friday nights; infrastructure created in the console; one shared admin account for the cloud console; secrets in a shared spreadsheet; no monitoring beyond CPU alerts; tests run manually by QA for two weeks per release.`,
  a: r`**Critical — security and control (weeks 1-4)**
1. **Shared admin account**: no accountability, likely MFA weaknesses, cannot be revoked per person. → Individual SSO identities with MFA, role-based access, break-glass account sealed and monitored; rotate the shared credentials immediately; review audit logs for misuse.
2. **Secrets in a spreadsheet**: anyone with the file has production access. → Move to a secrets manager, rotate every secret (assume exposure), restrict and audit access; remove the spreadsheet.
3. **Manual RDP deployments**: no traceability, inconsistent, single person dependency, segregation-of-duties failure. → Immediate interim: documented, scripted deployment with peer review and logging; then pipeline-based deployments (see below).

**High — reliability and visibility (months 1-3)**
4. **No meaningful monitoring**: CPU alerts miss user impact. → SLIs/SLOs for critical journeys, application telemetry (OpenTelemetry), burn-rate alerts, on-call rota with runbooks.
5. **Friday-night releases**: low staffing for recovery, big batches. → Daytime releases with rollback plans; aim for smaller, more frequent changes.

**Medium — delivery capability (months 2-6)**
6. **Console-created infrastructure**: drift, no DR reproducibility. → Import existing resources into IaC (import blocks), modules for new infrastructure, policies, drift detection.
7. **Two-week manual QA**: slow feedback, batches. → Test automation strategy (unit, contract, integration with Testcontainers, a focused E2E suite), QA engineers moving into test automation and exploratory testing; regression suite in CI.
8. **CI/CD pipeline** with build-once artefacts, automated deploys to test, progressive production rollout, automated change evidence.

**How to run it**: risk register with owners and dates, quick wins first to build trust (SSO + secrets manager are visible risk reductions), weekly progress review with leadership, measure DORA baseline and track improvement. Address people: the operations engineer's knowledge is essential — involve them in building the pipeline and runbooks; avoid blame.`,
  code: r`~~~text
Remediation plan (excerpt)
#  Finding                              Risk      Action                                          Owner      Due
1  Shared cloud admin account           Critical  SSO + MFA per person, break-glass sealed         Cloud lead  +7d
2  Secrets in spreadsheet               Critical  Secrets manager, rotate all, delete sheet        Security    +10d
3  Manual RDP deploys                   Critical  Scripted + reviewed interim; pipeline by +60d    Platform    +14d
4  CPU-only monitoring                  High      SLOs, OTel, burn-rate alerts, on-call rota       SRE         +45d
5  Friday-night releases                High      Daytime releases with rollback plan              Eng mgr     +14d
6  Console infrastructure               Medium    Import to Terraform, drift detection             Platform    +120d
7  2-week manual QA cycle               Medium    Test automation roadmap, CI regression suite     QA lead     +180d
Baseline: lead time 6 weeks, deploys monthly, CFR ~30% (estimated), recovery ~5 h
~~~`,
  dia: r`flowchart LR
  subgraph Before
    OPS[Ops engineer: RDP + file copy Friday night] --> PROD1[Production]
    SHEET[Secrets spreadsheet] --> OPS
    ADMIN[Shared admin account] --> CONSOLE[Console infra]
  end
  subgraph After
    PR[PR + review] --> CI[CI: tests, scans]
    CI --> CD[Pipeline deploy - progressive, daytime]
    CD --> PROD2[Production]
    SM[Secrets manager] --> CD
    SSO[SSO + MFA + JIT access] --> IAC[IaC + policies]
    PROD2 --> SLO[SLOs + alerts + on-call]
  end`,
  pts: [r`Fix identity and secrets exposure first: SSO, MFA, secrets manager, rotation.`, r`Replace manual deploys with scripted then pipeline deployments.`, r`Add user-centric monitoring and sustainable on-call; stop Friday-night big releases.`, r`Bring infrastructure into IaC and automate testing over months.`, r`Risk register, quick wins, metrics baseline, and involve existing staff.`],
  ex: r`At a fintech with exactly this setup, rotating the spreadsheet secrets revealed two former contractors still had working production credentials; SSO and a secrets manager were in place within two weeks.`,
  fu: [r`What would you do first on day one?`, r`How do you transition the QA team's role without losing their knowledge?`],
  pit: [r`Starting with a big CI/CD project while secrets and admin access remain exposed.`, r`Blaming the operations engineer.`, r`No baseline to show progress.`] },

{ id: 'q47', level: 'Principal', tags: ['infrastructure-change-risk', 'blast-radius', 'waves', 'freezes'],
  q: r`Infrastructure changes (network rules, IAM, DNS, Kubernetes upgrades, shared modules) cause a disproportionate share of your incidents. Design a risk management approach for infrastructure change at scale.`,
  a: r`**Why infrastructure changes are risky**: high blast radius (one route table or IAM policy affects many services), weaker testing than application code, delayed effects (DNS TTLs, certificate expiry), and often applied globally in one step.

**Classify changes by blast radius and reversibility**
| Class | Examples | Controls |
|---|---|---|
| Low | tags, new isolated resources, scaling | automated pipeline, plan review |
| Medium | service-level security groups, single-cluster add-on upgrades | staged rollout, automated checks |
| High | shared network routes, organisation-level IAM/SCPs, DNS zones, KMS key policies, cluster version upgrades, shared module major versions | waves, canaries, explicit rollback plan, change windows, two approvers, pre-mortem |

**Progressive rollout for infrastructure**
- **Waves**: apply to sandbox → dev → one low-risk production account/region/cluster (canary) → remaining production in batches, with health checks between waves (SLOs of affected services, error rates, synthetic probes).
- **Cell-based architecture** (q42 in the AWS topic) makes waves natural: change one cell at a time.
- Automated **pre- and post-change verification**: connectivity tests, IAM access simulations (policy simulators, Access Analyzer), DNS resolution checks, certificate validity.
- **Feature flags for infrastructure** where possible (weighted DNS records, gateway route weights, gradual rule enforcement modes — audit mode before deny).

**Reversibility**: keep previous configurations ready (previous module version, DNS records with low TTL before changes, IAM policy versions), rehearse rollback; avoid combining multiple high-risk changes.

**Change calendar and freezes**: avoid high-risk infrastructure changes during peak business periods (market open, month-end, Black Friday) — a targeted freeze for high-risk classes, not a blanket ban on all changes.

**Learning**: tag incidents by change type; track infrastructure change failure rate separately; pre-mortems for high-risk changes ("imagine this failed — why?"); policy updates from postmortems (for example, SCP changes must first run in a test organisation).`,
  code: r`~~~yaml
# Wave-based rollout for a shared network module upgrade (pipeline definition excerpt)
stages:
  - name: sandbox
    stacks: [sandbox/eu-west-1/network]
  - name: nonprod
    stacks: [dev/eu-west-1/network, staging/eu-west-1/network]
    verify: [connectivity-tests, dns-resolution-tests]
  - name: prod-canary
    stacks: [prod/eu-west-2/network]               # lowest-traffic production region
    approval: { required: 2, roles: [network-lead, sre-oncall] }
    bake_time: 24h
    verify: [connectivity-tests, slo-check:tier0, synthetic-probes]
  - name: prod-rest
    stacks: [prod/eu-west-1/network, prod/eu-central-1/network]
    window: "Tue-Thu 10:00-15:00 Europe/London"    # avoid month-end and market open
    rollback: { module_version: "1.8.1" }
~~~`,
  dia: r`flowchart LR
  CH[Infra change] --> CL{Blast radius + reversibility}
  CL -->|low| AUTO[Pipeline + plan review]
  CL -->|high| PRE[Pre-mortem, two approvers, rollback plan]
  PRE --> W1[Sandbox / dev]
  W1 --> W2[Prod canary region - bake 24 h]
  W2 --> W3[Remaining prod in batches]
  W2 -->|SLO or probe failure| RB[Rollback to previous version]`,
  pts: [r`Infrastructure changes have large blast radius and weaker testing.`, r`Classify by blast radius and reversibility with proportional controls.`, r`Roll out in waves with canaries, bake times and automated verification.`, r`Keep rollback ready; avoid combining high-risk changes.`, r`Targeted freezes during peaks; track infra change failure rate and learn.`],
  ex: r`An SCP change blocked a critical KMS action across all production accounts for 40 minutes; afterwards SCPs were applied to a test organisation and one canary account with a 24-hour bake before rollout.`,
  fu: [r`How do you canary an organisation-wide IAM policy change?`, r`What verification would you automate after a DNS change?`],
  pit: [r`Applying shared network or IAM changes everywhere at once.`, r`No bake time between waves.`, r`Blanket freezes instead of risk-based controls.`] },

{ id: 'q48', level: 'Principal', tags: ['identity', 'long-lived-credentials', 'zero-standing-privilege', 'strategy'],
  q: r`Lead an organisation-wide programme to eliminate long-lived credentials (cloud access keys, service account passwords, CI secrets, SSH keys, database passwords) and standing privileged access. What is the target state, sequencing and measurement?`,
  a: r`**Why**: long-lived credentials are the most common root cause of cloud breaches — they leak through code, logs, laptops and CI systems, and they work until someone notices. Standing admin access multiplies the impact.

**Target state**
| Credential today | Target |
|---|---|
| Cloud access keys for humans | SSO with MFA, short-lived sessions, just-in-time elevation (PIM, Identity Center permission sets with approval) |
| CI/CD cloud keys | OIDC workload identity federation, scoped by repo/branch/environment |
| Application cloud credentials | workload identity (IAM roles, IRSA/Pod Identity, managed identities) |
| Database passwords | IAM/Entra database authentication, or dynamic secrets (Vault) with short leases |
| SSH keys to servers | Session Manager/Bastion with SSO, short-lived certificates; immutable servers with no SSH |
| Service-to-service secrets | mTLS with workload identities (SPIFFE), OAuth client credentials with short-lived tokens |
| Third-party API keys (unavoidable) | vault-stored, rotated automatically, scoped minimally, monitored |
| Standing admin roles | zero standing privilege: time-bound elevation with approval and recording |

**Sequencing**
1. **Inventory** credentials (cloud IAM reports, secret scanning across repos/CI, vault inventories, database users) with owners and last-use data.
2. **Stop the bleeding**: push protection for secret scanning, block creation of new IAM users/access keys via guardrails (SCP/Azure Policy), alerts on new long-lived credentials.
3. **Quick wins**: CI OIDC (high leak risk, easy), human SSO/JIT.
4. **Workloads**: platform golden paths with workload identity by default; migrate services in waves.
5. **Databases and legacy**: IAM auth or dynamic secrets; legacy systems behind vault with rotation.
6. **Decommission**: remove unused credentials (last-used reports), then the remaining exceptions with time-bound plans.

**Measurement**: number of long-lived credentials by type and age (trend to zero), % workloads using workload identity, % CI pipelines on OIDC, standing privileged accounts, mean credential age, secret-scanning hits blocked vs leaked.

**Governance**: exceptions registry with owners and expiry; quarterly reporting to the security committee; policies preventing regression.`,
  code: r`~~~json
// Guardrail (SCP): prevent creating new long-lived IAM user credentials; only break-glass automation exempt
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyLongLivedCredentials",
    "Effect": "Deny",
    "Action": ["iam:CreateUser", "iam:CreateAccessKey", "iam:CreateLoginProfile"],
    "Resource": "*",
    "Condition": { "ArnNotLike": { "aws:PrincipalArn": "arn:aws:iam::*:role/BreakGlassProvisioner" } }
  }]
}
~~~
~~~bash
# Inventory: access keys older than 90 days (input for the programme dashboard)
aws iam generate-credential-report >/dev/null; sleep 5
aws iam get-credential-report --query Content --output text | base64 -d | \
  awk -F, 'NR>1 && $9=="true" { print $1, $10 }'   # user, access_key_1_last_rotated
~~~`,
  dia: r`flowchart LR
  INV[Inventory credentials + owners + last use] --> STOP[Stop new: push protection, SCP deny keys]
  STOP --> QW[Quick wins: CI OIDC, human SSO + JIT]
  QW --> WL[Workload identity via golden paths]
  WL --> DB[DB IAM auth / dynamic secrets]
  DB --> DEC[Decommission + time-bound exceptions]
  DEC --> MET[Metrics: count and age trend to zero]`,
  pts: [r`Long-lived credentials and standing privilege drive most cloud breaches.`, r`Target: SSO/JIT for humans, OIDC for CI, workload identity, IAM DB auth or dynamic secrets.`, r`Inventory, stop new ones, quick wins, then workloads, databases and legacy.`, r`Measure counts, ages and adoption; prevent regression with guardrails.`, r`Exceptions registry with owners and expiries.`],
  ex: r`A bank reduced long-lived cloud access keys from 1,900 to 40 in a year; a later leaked CI log contained only an expired OIDC-issued token, turning a potential breach into a non-event.`,
  fu: [r`How do you handle a vendor that only supports static API keys?`, r`What does zero standing privilege mean for on-call engineers at 3 a.m.?`],
  pit: [r`Rotating keys without eliminating them.`, r`No guardrails preventing new keys.`, r`JIT access so slow that engineers create workarounds.`] },

{ id: 'q49', level: 'Principal', tags: ['brownfield', 'clickops', 'iac-adoption', 'legacy'],
  q: r`Bring a large click-ops estate (hundreds of cloud resources created by hand over years) under Infrastructure as Code without outages. How do you discover, prioritise, import, and keep it under control?`,
  a: r`**Discovery**
- Inventory resources across accounts/subscriptions (cloud asset inventories: AWS Config/Resource Explorer, Azure Resource Graph), with tags, creation dates, last activity and cost.
- Identify owners (tags, billing, CloudTrail/Activity Log creators, interviews); unknown-owner resources are candidates for decommissioning (after verification and notice).
- Map dependencies (networks, security groups, IAM roles, DNS) — import order follows dependencies.

**Prioritise**
1. **Security-critical and high-change resources**: IAM, network security rules, public exposure, KMS — benefits from review and policy most.
2. **Production-critical infrastructure**: databases, networking, clusters — reproducibility for DR.
3. **Frequently changed resources** — where drift and manual errors happen.
4. Long tail later; decommission unused resources instead of importing them (often 10-30% of an estate).

**Import technique**
- Use {{import}} blocks and generated configuration ({{terraform plan -generate-config-out}}), or tools like Terraformer/aztfexport as starting points — then **refactor** generated code into modules and standards.
- Work stack by stack; target a **no-change plan** before declaring a resource managed (proves code matches reality).
- Where resources do not meet standards (unencrypted, public), import as-is first, then fix with a separate, reviewed change — separating "adopt" from "change" reduces risk.
- Protect stateful resources ({{prevent_destroy}}, deletion protection) before any refactor.

**Keeping it under control**
- Read-only console access in production for humans; changes via pipelines; break-glass with alerts.
- Drift detection on all stacks; policies preventing untagged/unmanaged resource creation (tag policies requiring a {{managed-by}} tag set by IaC).
- New resources only via IaC/golden modules from day one (stop adding to the problem while paying it down).
- Track coverage: % resources managed by IaC per account, drift incidents, unmanaged resources created per month.`,
  code: r`~~~hcl
# Adopt existing production resources: import first, change later
import {
  to = aws_security_group.legacy_app
  id = "sg-0a1b2c3d4e5f67890"
}
import {
  to = aws_db_instance.legacy_orders
  id = "orders-prod"
}
resource "aws_db_instance" "legacy_orders" {
  identifier          = "orders-prod"
  engine              = "sqlserver-se"
  instance_class      = "db.m6i.2xlarge"
  # ...generated config, cleaned up...
  deletion_protection = true
  lifecycle { prevent_destroy = true }
}
~~~
~~~bash
terraform plan -generate-config-out=generated.tf     # draft config for import blocks without resources
terraform plan -detailed-exitcode                    # goal: exit 0 (no changes) before declaring adopted
# Azure equivalent starting point: aztfexport resource-group rg-orders-prod --non-interactive
~~~`,
  dia: r`flowchart LR
  DISC[Discover: inventory, owners, dependencies, cost] --> DEC[Decommission unused]
  DISC --> PRIO[Prioritise: security, prod-critical, frequently changed]
  PRIO --> IMP[Import + generated config]
  IMP --> NOCH[No-change plan = adopted]
  NOCH --> FIX[Separate reviewed changes to meet standards]
  FIX --> CTRL[Read-only console, drift detection, tag policy, IaC-only for new]
  CTRL --> COV[Coverage metrics]`,
  pts: [r`Discover resources, owners, dependencies and cost; decommission what is unused.`, r`Prioritise security-critical, production-critical and frequently changed resources.`, r`Import with generated config, refactor into modules, reach no-change plans.`, r`Adopt first, change later; protect stateful resources.`, r`Prevent new click-ops with read-only consoles, drift detection and policies; track coverage.`],
  ex: r`A bank found 28% of 4,000 hand-made resources were unused and deleted them; the rest were imported over nine months in priority order, and IaC coverage became an audit metric.`,
  fu: [r`How do you handle resources whose owners nobody can identify?`, r`Why separate importing from fixing non-compliant settings?`],
  pit: [r`Importing everything including unused resources.`, r`Changing configuration in the same step as importing.`, r`Allowing new click-ops while importing old resources.`] },

{ id: 'q50', level: 'Principal', tags: ['principles', 'summary'],
  q: r`Summarise the DevOps and SRE principles you would enforce as Principal Engineer in a regulated financial-services organisation.`,
  a: r`"My DevOps principles fit on one page:

- **Teams own outcomes end to end**: stream-aligned teams build and run their services; platforms provide self-service paved roads; enabling teams spread practices.
- **Small batches, flowing continuously**: trunk-based development, small PRs, feature flags, deploy daily with progressive delivery and automated analysis.
- **Everything as code**: infrastructure, policies, pipelines, configuration, dashboards and alerts — reviewed, versioned, tested; read-only consoles in production.
- **Reliability is a product feature**: SLOs per customer journey, error budgets with pre-agreed policies, burn-rate alerting, sustainable on-call, blameless postmortems with systemic actions.
- **Recovery is designed in**: expand/contract schema changes, tolerant readers, kill switches, rehearsed rollbacks and DR drills.
- **No long-lived credentials or standing privilege**: SSO, JIT access, OIDC for CI, workload identity, vaulted and rotated secrets.
- **Security and compliance shift left and run continuously**: diff-aware security gates, policy as code at plan and admission time, automated change evidence mapped to SOX, PCI DSS and DORA control objectives.
- **Measure to improve, not to judge**: DORA and developer-experience metrics for teams, not individuals; fund the constraints they reveal.
- **Cost is a requirement**: tagging, cost in PRs, unit economics, savings built into modules.
- **Learn continuously**: game days, chaos experiments, incident themes feeding the reliability roadmap."`,
  code: r`~~~text
Ownership     : stream-aligned teams build + run; platform as product; enabling teams rotate
Flow          : trunk-based, small PRs, flags, daily deploys, canary + automated analysis
As code       : Terraform/OpenTofu modules, policy as code, GitOps, read-only prod consoles
Reliability   : SLOs per journey, error budget policy, burn-rate alerts, blameless postmortems
Recovery      : expand/contract, tolerant readers, kill switches, rollback + DR drills
Identity      : SSO + JIT, OIDC CI, workload identity, vault + rotation, zero standing privilege
Compliance    : automated evidence for SOX / PCI DSS / DORA, standard changes, exceptions registry
Measurement   : DORA + DevEx for teams, never individuals
Cost          : tags enforced, Infracost in PRs, unit cost dashboards
Learning      : game days, chaos experiments, quarterly incident themes
~~~`,
  pts: [r`End-to-end team ownership with platforms and enabling teams.`, r`Small batches with progressive delivery and flags.`, r`Everything as code; reliability as a product feature with SLOs and error budgets.`, r`Designed-in recovery; no long-lived credentials; compliance automated.`, r`Measure to improve, treat cost as a requirement, and keep learning.`],
  ex: r`Encoding these principles into golden paths, policies and evidence pipelines let a bank raise deployment frequency tenfold while its change-management audit findings went to zero.`,
  fu: [r`Which principle would you implement first in an organisation releasing quarterly?`],
  pit: [r`Principles without automation, metrics and ownership behind them.`] }
],
cheat: r`### Foundations
DevOps = culture + automation to shorten idea → production safely · CALMS · Three Ways (flow, feedback, learning) · SRE implements DevOps for reliability · platform engineering reduces cognitive load · DORA: deployment frequency, lead time, change failure rate, failed deployment recovery time (+ reliability, rework) — speed and stability improve together.

### IaC (Terraform / OpenTofu)
Declarative + idempotent · plan → review (replacements, destroys, IAM, network) → apply from CI · remote state: locking, versioning, KMS; state holds secrets → restrict · one state per env/component · versioned modules, directory per env (not workspaces for prod) · drift: scheduled plan -detailed-exitcode · import blocks + generated config, moved/removed blocks for refactors · prevent_destroy + cloud deletion protection · policy as code on plan JSON (Conftest, Sentinel, Checkov) · terraform test, tflint, Terratest.

### Release & change
Deploy ≠ release (feature flags, OpenFeature) · rolling, blue-green, canary, shadow (no side effects) · expand/contract migrations, run migrations as a separate step · rollback fails on destructive schema, data, message formats, external side effects → roll forward, kill switches · canary analysis with business metrics · standard changes with automated evidence instead of CAB for every deploy.

### Reliability
SLI = good/valid · SLO target over window · SLA looser · error budget = 1 − SLO (99.95% ≈ 20 min/28 days) · error budget policy pre-agreed · burn-rate alerts (fast page, slow ticket) · incident roles: IC, ops, comms, scribe; mitigate first · blameless postmortems, contributing factors, systemic actions · toil cap ~50% · on-call 5-8 people, runbooks, actionable pages only · chaos experiments with stop conditions.

### Security & identity
Shift left: secret push protection, SAST, SCA, IaC scan, image scan, DAST; gate on new high-confidence findings · OIDC for CI, workload identity, vault + dynamic secrets, dual-credential rotation · package source mapping vs dependency confusion · leaked secret: assume compromise, revoke in minutes, audit usage, notify if required.

### Organisation & governance
Team Topologies: stream-aligned, platform, enabling, complicated-subsystem; X-as-a-Service · platform as product, thinnest viable platform · compliance as code: control objectives → automated controls → evidence store · DORA (EU): major ICT incident initial notification within 4 h of classification · metrics for teams, never individuals · Infracost in PRs, tags enforced.

### Say this
"Speed and stability are not a trade-off." "Deploy is not release." "Every resource has one owning tool." "Mitigate first, diagnose second." "Regulators want controlled change, not slow change." "Measure systems, not people."`
});
})(String.raw);
