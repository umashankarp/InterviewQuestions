# Module 185 — ML Lifecycle, MLOps & Model Risk Management: Feature Stores, Registries, Drift Monitoring, Champion/Challenger & Regulatory Independent Validation

> Domain: AI Systems (merged 44-50) | Level: Beginner → Expert | Prerequisite: [[../44-AI-Systems/10-Model-Adaptation-FineTuning-LoRA-PEFT-Distillation-PromptVsRAGVsTune]], [[../44-AI-Systems/11-AI-Evaluation-ContinuousAssurance-LLMAsJudge-EvalHarness-CIGates-OnlineExperiments]], [[../27-Observability/04-Observability-Capstone]], [[../25-DevOps/01-DevOps-Fundamentals-CultureAndPractices]]

>
> **Scope note:** Twelfth module of the merged `44-AI-Systems` domain and the **last of the 182–185 gap-fill**. Modules 162–184 are LLM-centric; this module covers what a FinTech Principal AI/ML role is actually expected to own that the rest of the folder doesn't: the **classical ML lifecycle** (most production "AI" in fraud, credit, AML, and pricing is still gradient-boosted trees and logistic regression, not LLMs), the **MLOps discipline** that automates and governs that loop (feature stores, registries, drift monitoring, champion/challenger), and the **Model Risk Management** overlay that regulated firms are legally required to run — independent validation, "effective challenge," model inventory, tiering, and periodic revalidation under **SR 11-7** (US), **SS1/23** (UK PRA), and **TRIM** (ECB). It also names where LLMs/GenAI stress this framework and what you do about it. §12 follows the four-step System Design spine. This module closes the domain.

---

## 1. Fundamentals

**What.** The **ML lifecycle** is the loop every production model lives in:

```
problem framing → data acquisition → feature engineering → training → validation →
   deployment (shadow → canary → prod) → monitoring (drift, performance) → retrain / retire
        ▲                                                                        │
        └────────────────────── feedback, drift, new requirements ───────────────┘
```

**MLOps** is the engineering discipline that makes that loop automated, reproducible, observable, and governed — the ML analogue of CI/CD + observability + change management. The unit it manages is not "the code" but **model = code + training data + features + hyperparameters + weights + serving config**, every part of which can change or drift independently.

**Model Risk Management (MRM)** is the regulated overlay. A model is *"a quantitative method that applies statistical, economic, financial, or mathematical theories to process input data into a quantitative estimate"* (SR 11-7). **Model risk** = the risk of loss from decisions based on a model that is *wrong* (bad design or data), *misused* (applied outside its valid domain), or *misunderstood* (its limitations not appreciated). Banks are required to manage it as a distinct risk category, with an **independent validation** function that provides **"effective challenge"** — a critical review by a party with the competence, influence, and incentive to challenge the model and get changes made.

**Why a Principal must own this.** In a bank, "we built a model" is the start, not the end. Before a fraud, credit, AML, capital, or pricing model goes live it must be: inventoried, tiered by materiality, independently validated (conceptual soundness + outcomes analysis + ongoing-monitoring plan), documented with its assumptions and use restrictions, approved by a governance committee, and revalidated periodically. Skipping this isn't a process shortcut — it's a regulatory finding, potentially a Matter Requiring Attention (MRA) or a consent order, and for material models it can block the model from being used at all. The Principal is the person who makes the engineering and the governance fit together instead of fighting.

**When it's classical ML vs an LLM.** Fraud scoring, credit decisioning, AML transaction monitoring, pricing, propensity, and forecasting are overwhelmingly **tabular models** — GBMs (XGBoost/LightGBM), logistic regression, sometimes neural nets — trained on structured features, scored in milliseconds, needing explainability for adverse-action notices. LLMs enter as *support* (summarising a case, drafting a rationale, extracting fields) — and when they touch a regulated decision, they inherit the *entire* MRM apparatus while being harder to validate (§2.6). Know which you're dealing with; the lifecycle and the risks differ.

**How (30,000-ft).**
```
FEATURE STORE:  offline (training, point-in-time correct) + online (serving, low-latency) — SAME definitions, or you get training/serving skew
TRAINING:       pipeline-as-code, data + code + config versioned, experiment-tracked, reproducible
REGISTRY:       model artefact = {code, data snapshot, features, hyperparams, weights, config, validation status, approver, limitations, monitoring plan}
DEPLOY:         shadow → champion/challenger → canary → prod, with rollback
MONITOR:        data drift (PSI/KS per feature) + concept drift + performance (when labels arrive) + proxy metrics while labels lag
GOVERN:         model inventory · materiality tiering · independent validation (SR 11-7) · use restrictions · periodic revalidation · governance committee sign-off
```

---

## 2. Deep Dive

### 2.1 Feature stores and training-serving skew

A **feature store** serves feature values in two modes from *one* set of definitions:

- **Offline store** — historical feature values for training and backtesting, queried with **point-in-time correctness**: for a training row labelled at time `t`, every feature must be the value *as known at `t`*, never a later value. Using a feature computed with data from after `t` is **label leakage** — the model learns from the future, scores brilliantly offline, and fails in production. Point-in-time joins ("time-travel joins", "as-of joins") enforce this.
- **Online store** — the latest feature values, served at single-digit-millisecond latency for real-time scoring (a fraud decision in the authorisation path has a ~10–50 ms budget for *everything*, features included).

**Training-serving skew** — the model was trained on feature values computed one way and is served feature values computed another way — is the single most common cause of "great offline metrics, disappointing production." Sources:

- Different code paths compute the "same" feature offline (a Spark batch job with the full window) vs online (a streaming aggregate, a different library, a different null-handling rule).
- The online feature is **stale or cold** — a 30-day aggregate that's only 6 days warm after a cache flush (§4).
- Time-zone / boundary / rounding differences.
- The offline pipeline silently imputes missing values; the online path passes nulls (or vice versa).

Defences: **share the transformation code** between offline and online (the feature store's job); **log the actual feature vector used for every production scoring event** and periodically compare it to what the offline pipeline would produce for the same entity/time (a skew detector — §11); feature **freshness monitoring** with SLAs; and treating a feature definition as a governed, owned, versioned artefact with lineage — not a snippet re-implemented per consumer.

### 2.2 Training pipelines and reproducibility

For a regulated model, "re-run the pipeline and get the same model" is a requirement, not a nicety — validators and auditors will ask.

- **Pipeline-as-code** — data pull, feature computation, training, evaluation as a versioned DAG (Airflow/Kubeflow/Metaflow/dbt+X), not notebooks.
- **Data versioning** — the exact training dataset snapshot is hashed and retained (Module 183 §12); "trained on last quarter's data" is not reproducible.
- **Experiment tracking** — every run's code version, data version, hyperparameters, metrics, and artefacts logged (MLflow/W&B/SageMaker Experiments).
- **Determinism where possible** — fixed seeds, pinned library versions, pinned base images; GBM training is largely deterministic, deep learning less so (document the residual variance).
- **The reproducibility bar** — a validator can take your pipeline definition + data snapshot and regenerate a model that matches within a documented tolerance.

### 2.3 Model registry and staged deployment

A model **registry** is not an artifact store — it's the governed record of every model version with:

- The artefact itself (weights/serialised model) + its lineage: code version, training-data snapshot hash, feature set + versions, hyperparameters, training environment.
- **Governance metadata**: validation status (`not validated` / `validated with conditions` / `validated`), the validation report reference, the approver, the **materiality tier**, documented **limitations and assumptions**, **use restrictions** (what decisions it may and may not drive), and the **ongoing-monitoring plan** (which metrics, thresholds, cadence).
- **Deployment state**: `dev → shadow → challenger → canary → production → retired`, with rollback always available.

Promotion between states is gated: `→ production` for a material model requires a `validated` status and a governance-committee approval, recorded.

### 2.4 Drift monitoring — and the label-lag reality

Four things drift, and they need different detection:

| Drift type | What changed | Detection | Needs labels? |
|---|---|---|---|
| **Data / covariate drift** | `P(X)` — the input distribution moved (new customer mix, new merchant category, a data-pipeline change) | Per-feature **PSI** (population stability index), KS-test, KL divergence, vs a training reference; alert on trend | No |
| **Concept drift** | `P(Y\|X)` — the *relationship* moved (fraud tactics evolved; macro conditions changed credit behaviour) | Performance decline with stable inputs; drift in residuals; requires labels or a good proxy | Usually |
| **Label drift** | `P(Y)` — the base rate moved (fraud rate up, default rate up) | Monitor the outcome base rate; recalibration may be needed even if ranking is fine | Yes |
| **Performance drift** | The metric (AUC, recall@k, precision) declined | Direct measurement once labels arrive | Yes |

**The label-lag problem is central in FinTech.** Fraud labels arrive in days–weeks (chargebacks). **Credit-default labels arrive in months** — a loan's "did it default" isn't known for 12–24 months. AML SAR outcomes lag further. So you **cannot measure a credit model's accuracy for a year after deployment.** In that gap you rely on:

- **Leading proxy indicators**: score-distribution stability (PSI on the model's *output*), approval/decline rate, override rate, early-payment default (EPD — default within 3–6 months, a partial early signal), portfolio mix, and vintage-curve tracking (comparing each origination cohort's early delinquency to prior cohorts at the same age).
- **Segment monitoring**: drift concentrated in a segment (a channel, a geography, a product) is a stronger signal than an aggregate shift.
- **Discipline**: pre-registered proxy thresholds with **floors**, and a policy that a sustained proxy breach triggers investigation and possibly a challenger or a hold — *not* "wait for the real labels" (by then the losses are booked). §14 is an incident about exactly this being mishandled.

### 2.5 Champion/challenger and shadow deployment

- **Shadow**: the new model scores live traffic in parallel with the incumbent; its scores are logged, not acted on. Zero customer risk; you compare score distributions, feature behaviour, and (as labels arrive) performance.
- **Champion/challenger**: the challenger takes a small, randomised slice of real decisions (or a shadow with delayed comparison); you promote on evidence — the challenger must beat the champion on the primary metric with adequate confidence *and* not regress guardrails (fairness metrics, stability, explainability quality, operational cost).
- **Difference from feature A/B (Module 184)**: you're comparing *models* making *decisions with real consequences and delayed labels*, often under a regulator's eye — so the comparison plan, the promotion criteria, and the fairness guardrails are themselves part of the model's documentation, and a challenger that will make real credit decisions needs its own (possibly lighter, tier-appropriate) validation.

### 2.6 Model Risk Management — SR 11-7 and "effective challenge"

**Three lines of defence:**
1. **Model development / ownership** (first line) — builds the model, owns its performance and monitoring.
2. **Independent model validation** (second line) — a separate function with the competence and independence to challenge the model; produces the validation report; has the authority to block or condition use.
3. **Internal audit** (third line) — checks that the MRM *process* is being followed.

**SR 11-7's three validation pillars:**
- **Conceptual soundness** — is the methodology appropriate for the purpose? Are the assumptions reasonable and documented? Is the variable selection sound (no leakage, no prohibited attributes, no proxies for them)? Is the model's design fit for how it will be used?
- **Ongoing monitoring** — is there a plan (metrics, thresholds, cadence, escalation) to confirm the model keeps working, and benchmarks/challengers to compare against?
- **Outcomes analysis** — back-testing and, once available, comparing predictions to actual outcomes; sensitivity analysis; benchmarking against alternative models.

**Supporting apparatus:** a complete **model inventory** (every model, its owner, tier, validation status, last/next validation date — an *incomplete* inventory, i.e. "shadow models," is a top finding); **materiality tiering** (a model driving billions in credit decisions gets deep validation and annual revalidation; a low-materiality internal forecasting tool gets a lighter touch); **documented limitations, assumptions, and use restrictions**; a **governance committee** that approves models for use; **periodic revalidation** (tier-driven cadence, and event-triggered — a material change, a performance breach, a new use); and a **findings/remediation** process with deadlines.

**How LLMs / GenAI stress this framework:**
- No stable "model equation" to inspect; behaviour is emergent and prompt-dependent.
- **Non-determinism** — you can't reproduce a specific output (Module 162 §2.4), which strains "outcomes analysis" and audit.
- **Vendor / hosted models** — you can't inspect the weights or training data of a model you call via API; validation becomes "validate the *use* and the guardrails and the evaluation, and rely on vendor attestations for the rest."
- **The moving base** — the hosted model changes under you (Module 183 §14).
- **Scope** — an LLM that only summarises a case for a human is arguably a low-tier support tool; the *same* LLM auto-deciding or auto-drafting a regulator-facing document is high-tier and needs the full apparatus. Getting the scoping right (and defensible) is the Principal's call.

Practical stance: keep LLMs **out of the regulated decision** where you can (use an interpretable model for the decision, the LLM for non-decisioning support); where an LLM must inform a decision, wrap it in a validated deterministic decision surface, exhaustive evaluation (Module 184), strong guardrails, human review on consequential outputs, and full documentation of what it can and can't do.

### 2.7 Explainability for regulated decisions

- **Tabular ML**: **SHAP** (Shapley-value feature attributions — the standard; global importance and per-decision local attributions) and **LIME** (local linear surrogate). Used for model understanding, validation, monitoring (attribution drift), and **adverse-action reasons** — under ECOA / Regulation B (US), a declined credit applicant must be told the **principal reasons**, which must be accurate and specific; you derive them from the model's per-decision attributions mapped to human-readable reason codes.
- **The LLM explainability gap**: attention weights are **not** explanations; a model's post-hoc "why did you say that" rationale is **not faithful** (it can be plausible and wrong). There is no SHAP-equivalent that gives a legally-defensible principal-reason for an LLM's judgement. So for a decision that needs a defensible "why," either use an interpretable model for the decision, or constrain the LLM to produce a *structured, checkable* output whose reasons come from verifiable evidence (retrieved facts, rule evaluations), not from the model's introspection.
- **Fairness / disparate impact**: variable selection must exclude prohibited attributes (race, sex, age in some contexts, etc.) *and* close proxies; test the model for disparate impact across protected classes (adverse-impact ratio, demographic parity / equalised-odds gaps as appropriate); this is a validation pillar and a legal requirement, not an optional metric.

---

## 3. Visual Architecture

**The ML platform & governance stack**

```
┌───────────────────────── FEATURE STORE ─────────────────────────┐
│  transformation definitions (versioned, owned, lineage)         │
│      │                                   │                      │
│  OFFLINE store (point-in-time            ONLINE store (low-      │
│  correct; training/backtest)             latency; real-time     │
│      │                                   scoring)               │
└──────┼───────────────────────────────────────┼─────────────────┘
       ▼                                        ▼
  TRAINING PIPELINE (as code)              SCORING SERVICE
  data snapshot + code + config             (features + model → score)
  → experiment tracking → model artefact         │  logs the actual feature vector used
       │                                         ▼
       ▼                                   SKEW DETECTOR: online-logged vs offline-recomputed
  MODEL REGISTRY  {artefact + lineage + validation status + tier +
                   limitations + use restrictions + monitoring plan}
       │  promote (gated)
       ▼
  DEPLOY: shadow → challenger → canary → production   (rollback always)
       │
       ▼
  MONITORING:  data drift (PSI/KS per feature) · output/score drift ·
               concept & performance drift (when labels arrive) ·
               proxy indicators (EPD, vintage curves, approval rate) while labels lag ·
               fairness metrics · attribution drift
       │  breach → investigate / challenger / hold
       ▼
  GOVERNANCE (Model Risk Management)
   ├─ model inventory (complete — no shadow models)
   ├─ materiality tiering  → validation depth & revalidation cadence
   ├─ INDEPENDENT VALIDATION (2nd line): conceptual soundness · ongoing monitoring · outcomes analysis  → "effective challenge"
   ├─ governance committee approval for use
   ├─ documented limitations / assumptions / use restrictions
   └─ periodic + event-triggered revalidation ; findings & remediation with deadlines
  Internal audit (3rd line): is the process followed?
```

**Feature: offline/online parity and the skew window**

```
feature "merchant_avg_txn_30d"

training:  Spark batch, full 30-day window, as-of the label time  ──►  offline value  V_off
serving:   streaming aggregate, warm since last deploy/cache-flush ──►  online value   V_on

steady state:      V_on ≈ V_off      ✔
post-deploy window: aggregate only ~6 days warm  →  V_on ≪ V_off   ✘  (model scores on a wrong feature)

skew detector: for a sample of scored entities, recompute V_off from the offline pipeline
               and compare to the logged V_on  → alert when |V_on − V_off| / V_off exceeds a bound
```

---

## 4. Production Example

**Context.** A payments company runs a real-time card-fraud model (LightGBM, ~400 features, scored in the authorisation path with a ~35 ms total budget). Features come from an online feature store. One family of features is rolling merchant/cardholder aggregates — e.g. `merchant_avg_txn_amount_30d`, `card_txn_count_7d`, `card_distinct_mcc_30d`. Offline (training) these are computed by a Spark job with the full historical window, point-in-time correct. Online they're maintained as **streaming aggregates** in the online store. The team verified "feature parity" by sampling steady-state traffic: online and offline values matched within tolerance. Model shipped; offline PR-AUC excellent; fraud catch-rate on target.

**The incident.** Over three months, the fraud team noticed that **card-present fraud losses spiked in a repeating pattern — always in the hours immediately following a platform deploy**, then recovered. Deploys happened ~2×/week. Each spike was a few hours of degraded detection; cumulatively it was a material and growing loss, and it was baffling because deploys didn't touch the model.

**Investigation.**
- The scoring service logged the full feature vector for every authorisation. Pulling vectors from a post-deploy window and comparing to a normal window: the rolling-aggregate features (`*_30d`, `*_7d`) were **systematically low** for ~4–8 hours after each deploy, then normalised.
- The online store's streaming-aggregate state was held in a stateful stream processor whose local state was **not preserved across the deploy** — a rolling restart re-seeded the aggregates from an empty (or short) window and they took hours to "warm up" to a true 30-day value.
- So for hours after each deploy, `merchant_avg_txn_amount_30d` might reflect ~6 days of data, `card_distinct_mcc_30d` might be near zero for cards not seen since the restart — and the model, trained on true 30-day values, saw these low values as *lower risk* (a merchant with a low average and a card with few distinct MCCs looks benign), so genuinely risky transactions scored below the decline threshold.
- **Root cause**, in the domain's recurring form: **"feature parity" was verified only in steady state; the online feature computation had an operational failure mode — cold aggregates after a deploy — that made the online value systematically wrong in a window nobody tested, so the declared parity did not hold when it mattered.** Module 182 §4/§14's "a check that only covers steady state misses the operational property that bites"; and the "great offline metrics, bad in a production window" signature of training-serving skew.

**Fix.**
1. **Persist / checkpoint the streaming-aggregate state across deploys** (state snapshots restored on restart) so aggregates are warm immediately. Where a cold window is unavoidable, **backfill the aggregate from the offline store on startup** before the instance joins the scoring pool.
2. **Feature freshness + completeness signal**: each rolling-aggregate feature carries a "window coverage" indicator (how many days of data it actually reflects); the scoring service treats a low-coverage feature as **missing** (triggering the model's trained missing-value handling and a conservative fallback), not as a valid low value.
3. **Skew detector in production** (§11 exercise): continuously sample scored entities, recompute the features from the offline pipeline, and alert when the online-vs-offline divergence on any feature exceeds a bound — this would have caught the post-deploy window on day one.
4. **Deploy-aware monitoring**: fraud catch-rate and score-distribution PSI sliced by "minutes since last deploy" so a deploy-correlated regression is visible.
5. **Guardrail**: a deploy that causes the skew detector to fire is auto-rolled-back or the scoring service holds at a conservative posture until features are verified warm.

**Lessons.**
- **"Feature parity" verified only in steady state is not parity.** The online feature computation has operational failure modes — cold state, staleness, a restart — and the value it produces in those windows is what the model actually scores on. Test parity *through* a deploy and a restart, not just at rest.
- **A systematically-wrong feature value is worse than a missing one** — the model has trained missing-value handling; it has no defence against a plausible-but-wrong number. Give aggregate features a coverage signal and treat under-covered ones as missing.
- **Log every production feature vector and reconcile it against the offline pipeline** — training-serving skew is invisible from offline metrics alone; the only reliable detector is comparing what was actually served to what should have been.
- Same shape as Module 182 §4: the system was functionally correct; it failed on an operational property (feature-store state across a deploy) that no functional or steady-state test exercised.
## 10. Interview Questions

### Basic (10)

**B1. Q: What is the ML lifecycle and how does MLOps relate to it?**
*Ideal answer:* The lifecycle is the loop: problem framing → data → features → training → validation → deployment → monitoring → retrain/retire, with drift and new requirements feeding back. MLOps is the engineering discipline that makes that loop automated, reproducible, observable, and governed — the ML analogue of CI/CD plus observability plus change management. The thing it manages is model = code + data + features + hyperparameters + weights + config, all of which can drift independently.
*Why correct:* The loop, MLOps as the discipline over it, and the "model is more than code" point.
*Common mistakes:* Treating deployment as the end; thinking MLOps is just "CI/CD for models."
*Follow-up:* "Which parts of 'the model' drift?" / "How is this different from deploying a normal service?"

**B2. Q: What is a feature store and why have offline and online components?**
*Ideal answer:* A feature store serves feature values from one set of definitions in two modes: an offline store for training and backtesting, queried with point-in-time correctness (feature values as known at the label time); and an online store for low-latency real-time scoring (single-digit ms). Both exist so training and serving use the *same* feature definitions — computing a feature differently in training vs production is training-serving skew, the top cause of "great offline, bad in production."
*Why correct:* One definition / two modes, point-in-time offline, low-latency online, and the skew rationale.
*Common mistakes:* Thinking it's just a cache; not knowing about point-in-time correctness.
*Follow-up:* "What is point-in-time correctness and what breaks without it?" / "How do you prevent skew between the two?"

**B3. Q: What is training-serving skew?**
*Ideal answer:* When the model is trained on feature values computed one way and served feature values computed a different way — different code paths, stale or cold online aggregates, different null handling, time-zone/rounding differences. The model's offline metrics look great because the training features were consistent, but in production it scores on subtly (or grossly) different inputs and underperforms. The defence is sharing transformation code between offline and online, and logging the production feature vector to compare against the offline recomputation.
*Why correct:* Definition, causes, the offline-good/online-bad signature, and the detection.
*Common mistakes:* Not knowing the term; assuming feature parity if steady-state samples match.
*Follow-up:* "How would you detect it in production?" / "Give an operational failure mode that causes it."

**B4. Q: What is data drift vs concept drift?**
*Ideal answer:* Data (covariate) drift is a change in the input distribution `P(X)` — a new customer mix, a new merchant category, a data-pipeline change — detectable without labels via per-feature PSI/KS tests against a training reference. Concept drift is a change in the relationship `P(Y|X)` — fraud tactics evolved, macro conditions changed credit behaviour — so the same inputs now map to different outcomes; it shows up as performance decline with stable inputs and generally needs labels or a good proxy to detect.
*Why correct:* `P(X)` vs `P(Y|X)`, label-free vs label-dependent detection, examples.
*Common mistakes:* Conflating the two; thinking drift always needs labels.
*Follow-up:* "You see input drift but performance is fine — act or not?" / "How do you detect concept drift when labels lag a year?"

**B5. Q: Why can't you measure a credit model's accuracy shortly after deployment, and what do you do instead?**
*Ideal answer:* Default labels take months to years to materialise — you don't know if a loan defaults for 12–24 months. So for that window you rely on leading proxy indicators: score-distribution stability (PSI on the model output), approval/decline and override rates, early-payment default (default within 3–6 months), and vintage-curve tracking (comparing each origination cohort's early delinquency to prior cohorts at the same age), monitored per segment with pre-registered thresholds. A sustained proxy breach triggers investigation, a challenger, or a hold — you act on the proxy rather than waiting for the real labels, because by then losses are booked.
*Why correct:* The label-lag reality, the specific proxies (EPD, vintage curves, score PSI), and acting on proxies.
*Common mistakes:* "Wait for the labels"; only monitoring aggregate approval rate.
*Follow-up:* "What's a vintage curve?" / "Proxy breached but it might be seasonality — what do you do?"

**B6. Q: What is champion/challenger deployment?**
*Ideal answer:* Running a candidate model (challenger) alongside the incumbent (champion) — in shadow (scores logged, not acted on) or on a small randomised slice of real decisions — and promoting the challenger only on evidence: it beats the champion on the primary metric with adequate confidence and doesn't regress guardrails (fairness, stability, explainability, cost). It's how you get evidence-based promotion and detect that the champion has decayed, for models making consequential decisions with often-delayed labels.
*Why correct:* Shadow/slice, evidence-based promotion, guardrails, the "detect decay" benefit.
*Common mistakes:* Confusing it with a feature A/B; promoting on offline metrics alone.
*Follow-up:* "How is this different from an A/B test of a feature?" / "Does the challenger need its own validation?"

**B7. Q: What is Model Risk Management and what is "effective challenge"?**
*Ideal answer:* MRM is the regulated discipline of managing the risk that a model is wrong, misused, or misunderstood, treated as a distinct risk category in banks. "Effective challenge" (from SR 11-7) is critical review of a model by an independent party with the competence, standing, and incentive to genuinely challenge it and get changes made — not a rubber stamp. It's delivered by the independent model validation function (the second line of defence), separate from the developers.
*Why correct:* Model risk = wrong/misused/misunderstood; effective challenge = competent, independent, empowered review.
*Common mistakes:* Treating validation as QA; "independent" meaning "a different teammate."
*Follow-up:* "What are the three lines of defence?" / "What makes challenge 'effective' vs a rubber stamp?"

**B8. Q: What are SR 11-7's three validation pillars?**
*Ideal answer:* (1) Conceptual soundness — is the methodology appropriate for the purpose, are assumptions reasonable and documented, is variable selection sound (no leakage, no prohibited attributes/proxies). (2) Ongoing monitoring — is there a plan (metrics, thresholds, cadence, escalation, benchmarks) to confirm the model keeps working. (3) Outcomes analysis — back-testing, comparing predictions to actual outcomes as they arrive, sensitivity analysis, benchmarking against alternatives.
*Why correct:* The three pillars named and described.
*Common mistakes:* Only "test the accuracy"; forgetting conceptual soundness and ongoing monitoring are equal pillars.
*Follow-up:* "Which pillar is hardest for an LLM and why?" / "What's a model inventory and why does its completeness matter?"

**B9. Q: How do you generate an adverse-action reason for a declined credit applicant from a model?**
*Ideal answer:* Under ECOA / Regulation B you must give the principal reasons for the decline, and they must be accurate and specific. For a tabular model you compute per-decision feature attributions (SHAP is standard), identify the features that pushed the score toward decline most for that applicant, and map them to pre-defined human-readable reason codes ("insufficient credit history", "high revolving utilisation"). The reason codes must faithfully reflect the model's actual behaviour for that applicant, not a generic list.
*Why correct:* Reg B requirement, SHAP per-decision attributions → reason codes, faithfulness requirement.
*Common mistakes:* A generic reason list; using global feature importance instead of the per-applicant attribution.
*Follow-up:* "Why can't you do this for an LLM's judgement?" / "What makes a reason code 'faithful'?"

**B10. Q: Why are attention weights and an LLM's self-explanation not valid explanations?**
*Ideal answer:* Attention weights show where the model looked, not why it decided — high attention doesn't mean causal influence on the output, and you can often change the output without changing attention much (and vice versa). An LLM's post-hoc "why did I say that" is a *generated* rationale that sounds plausible but isn't guaranteed to reflect the actual computation — it can be confidently wrong (unfaithful). Neither gives a legally-defensible principal reason. For decisions needing a defensible "why," use an interpretable model or constrain the LLM to output reasons grounded in verifiable evidence (retrieved facts, rule evaluations).
*Why correct:* Attention ≠ causation; post-hoc rationale ≠ faithful; the defensible-decision implication.
*Common mistakes:* "Just ask the model to explain itself"; treating attention as interpretability.
*Follow-up:* "What do you do when a decision needs a defensible explanation and you want to use an LLM?" / "What's 'faithfulness' of an explanation?"

### Intermediate (10)

**I1. Q: A model has excellent offline metrics but underwhelming production performance. Walk the investigation.**
*Ideal answer:* Prime suspect: **training-serving skew**. Steps: (1) Log the production feature vectors and recompute the same features from the offline pipeline for the same entities/times; compare per feature — any systematic divergence is the skew. (2) Check for **operational** skew causes — cold/stale online aggregates after a deploy, a different library/null-handling online, time-zone/rounding. (3) Check for **feature leakage** in training — a non-point-in-time join let a feature use post-label data, inflating offline metrics (production can't replicate it). (4) Check the **evaluation** — was the offline test set a random split of a skewed/time-mixed pool (Module 183 §4, Module 184 §4)? (5) Check **population shift** — production traffic differs from the training distribution. (6) Check the **label definition** matches between offline and the production outcome. Fix per cause; add a standing skew detector and production-feature-vector logging.
*Why correct:* Skew-first (with recompute-and-compare), then operational causes, leakage, eval construction, population shift, label mismatch.
*Common mistakes:* Assuming the model is "just worse in the real world"; not logging/comparing feature vectors.
*Follow-up:* "How exactly do you build the skew comparison?" / "Which of these does retraining fix?"

**I2. Q: Design the drift monitoring for a fraud model.**
*Ideal answer:* **Input drift**: per-feature PSI/KS vs the training reference, prioritised to the top-importance features and computed per segment (channel, geography, MCC), alert on trend and on a threshold, daily. **Output drift**: PSI on the score distribution and the decline rate. **Concept/performance drift**: fraud labels arrive in days–weeks (chargebacks), so track recall@threshold, precision, and PR-AUC on a rolling window as labels land, sliced by segment. **Proxy while labels partial**: chargeback rate, manual-review queue rate, analyst override rate. **Fairness/stability guardrails**. **Feature health**: freshness and window-coverage per feature; a skew-detector alert. **Deploy-correlation**: metrics sliced by time-since-deploy (§4). Alert on trends, route to a triage flow, and have a defined response ladder (investigate → challenger → threshold adjustment → hold).
*Why correct:* Input/output/concept drift with segment slicing, fraud-appropriate label cadence, proxies, feature health, deploy-correlation, a response ladder.
*Common mistakes:* Aggregate-only PSI; no segment slicing; no feature-health monitoring; no response plan.
*Follow-up:* "Why slice by time-since-deploy?" / "PSI on feature X is 0.3 — is that actionable?"

**I3. Q: What is point-in-time correctness in a feature store and what's the failure if you get it wrong?**
*Ideal answer:* For a training example labelled at time `t`, every feature value in that row must be the value that was *known as of `t`* — not a value computed with any data from after `t`. Get it wrong and you have **label leakage**: the model trains on information from the future (e.g. "total chargebacks on this card in the 30 days *around* the transaction" includes chargebacks *caused by* the fraud you're trying to predict), so offline metrics are spectacular and meaningless, and production — which only has past data — performs far worse. The fix is as-of / time-travel joins that enforce the temporal cut per row.
*Why correct:* As-of-label-time definition, the leakage failure with a concrete example, and the as-of-join fix.
*Common mistakes:* Thinking a single global train/test time split is enough; not seeing windowed aggregates as a leakage vector.
*Follow-up:* "Give a subtle leakage example in a windowed feature." / "How does a time-travel join work?"

**I4. Q: How do you decide the validation depth and revalidation cadence for a model?**
*Ideal answer:* By **materiality tier** — a function of the model's financial exposure, the number/consequence of decisions it drives, regulatory sensitivity, and complexity. A high-materiality model (drives billions in credit decisions, or feeds regulatory capital) gets deep independent validation across all three SR 11-7 pillars and annual revalidation plus event triggers. A low-materiality model (an internal forecasting aid, a non-decisioning support tool) gets a lighter, proportionate review and a longer cadence. Event triggers apply at every tier: a material change to the model/data/use, a performance-threshold breach, a new use case, or a regulatory change forces revalidation regardless of the schedule.
*Why correct:* Materiality tiering drivers, proportionate depth/cadence, and the event triggers.
*Common mistakes:* One-size-fits-all validation; only scheduled, no event triggers.
*Follow-up:* "What are the inputs to a materiality score?" / "An LLM summariser vs an LLM auto-decisioner — same tier?"

**I5. Q: A team wants to add `applicant_first_name` embeddings as a feature to a credit model "because it improves AUC." Your response?**
*Ideal answer:* Block it. First name is a strong proxy for protected attributes (race, ethnicity, national origin, sex), so a feature derived from it will encode disparate impact — a fair-lending violation under ECOA regardless of intent, and it will fail validation's conceptual-soundness and disparate-impact tests. "It improves AUC" is often *because* it's picking up the protected-attribute signal. The feature-onboarding process should catch this: a prohibited-attribute and proxy review, feature lineage showing what each feature is derived from, and disparate-impact testing as a gate. Point the team at legitimate credit-risk features instead.
*Why correct:* Proxy for protected attributes → disparate impact → fair-lending violation; the AUC gain is a red flag; feature governance should catch it.
*Common mistakes:* Allowing it because it's "just a name embedding"; treating it as a pure modelling decision.
*Follow-up:* "What other features are common protected-attribute proxies?" / "How do you test for disparate impact?"

**I6. Q: Explain the three lines of defence and where model development sits.**
*Ideal answer:* First line: the business / model development — owns the model, its performance, its monitoring, and the primary responsibility for managing its risk. Second line: independent model validation (and broader risk management) — challenges the model, produces the validation report, sets standards, and has the authority to block or condition use; it is organisationally independent of the first line. Third line: internal audit — independently assesses whether the MRM framework and processes are being followed and are effective. Model development sits in the first line and cannot validate its own model — that's the whole point of the second line.
*Why correct:* The three lines with their roles, independence of the second line, dev in the first line.
*Common mistakes:* Putting validation in the first line; thinking audit does the validation.
*Follow-up:* "Why can't the first line validate its own model?" / "What authority does the second line need to make challenge 'effective'?"

**I7. Q: How does a hosted LLM complicate SR 11-7 validation, and what's the practical approach?**
*Ideal answer:* You can't inspect the weights, training data, or exact behaviour of a model you call via API, and it can change under you (Module 183 §14), and its outputs are non-deterministic (Module 162) so classic outcomes analysis and audit reproduction strain. Practical approach: shift validation to what you *can* control — validate the **use case and scope** (is an LLM appropriate here at all?), the **input/output guardrails**, the **evaluation** (a rigorous golden-set + calibrated-judge + online-assurance regime — Module 184) as the substitute for inspecting internals, the **deterministic decision surface** you wrap around it, and the **human review** on consequential outputs; rely on **vendor attestations** (testing, data handling, no-train, change notice) for the parts you can't inspect; keep an **inspectable challenger/benchmark**; and document the residual uncertainty explicitly as a limitation.
*Why correct:* Names the opacity/non-determinism/moving-base problems and shifts validation to use/guardrails/evaluation/vendor-attestation/challenger with documented residual risk.
*Common mistakes:* "You can't validate it so you can't use it" (too absolute) or "the vendor validated it" (not sufficient).
*Follow-up:* "What vendor attestations would you require?" / "Where's the line where an LLM use case is too risky to validate?"

**I8. Q: Build vs buy for a feature store — how do you decide?**
*Ideal answer:* **Buy / adopt** (Feast open-source, or Tecton / SageMaker Feature Store / Databricks / Vertex) unless you have a strong reason not to — the hard parts (point-in-time correctness, offline/online consistency, low-latency serving at scale, lineage) are exactly what these solve and get wrong-once-then-fixed. **Build / heavily customise** when: data residency or an unusual data platform makes the managed options a poor fit; you have extreme latency or scale requirements they don't meet; or you're deeply invested in a stack they don't integrate with. Even then, don't reinvent point-in-time joins — build on a warehouse's time-travel + a proven online KV store. Whatever you choose, **validate the platform's point-in-time correctness once, centrally**, so every model doesn't re-litigate it.
*Why correct:* Buy-by-default (the hard parts are solved), specific build triggers, and central platform validation.
*Common mistakes:* Building a feature store from scratch for a first use case; not validating point-in-time correctness centrally.
*Follow-up:* "What's the single hardest thing a feature store has to get right?" / "How do you validate point-in-time correctness?"

**I9. Q: What goes in a model registry entry beyond the model artefact?**
*Ideal answer:* Lineage — code version, training-data snapshot hash, feature set and versions, hyperparameters, training environment/image. Governance metadata — validation status (not validated / validated with conditions / validated), the validation report reference, the approver, the materiality tier, documented limitations and assumptions, use restrictions (which decisions it may/may not drive), and the ongoing-monitoring plan (metrics, thresholds, cadence, escalation). Deployment state (dev/shadow/challenger/canary/prod/retired) with rollback pointer. It's a governed record, not an artifact store — promotion to production is gated on validation status and committee approval.
*Why correct:* Lineage + governance metadata + deployment state, and the "governed record not artifact store" framing.
*Common mistakes:* Listing only the artefact and metrics; forgetting use restrictions and the monitoring plan.
*Follow-up:* "Who sets the use restrictions?" / "What blocks promotion to production?"

**I10. Q: Your PSI on an important feature crossed 0.25 (commonly a 'significant shift' threshold). What do you actually do?**
*Ideal answer:* PSI 0.25 is a signal to investigate, not an automatic action. (1) **Localise it** — which segment(s), since when, gradual or step-change. A step-change often means a **data-pipeline change** (a source system changed a format, a default, a unit) — check deploys/releases first; that's a bug to fix, not model drift. (2) If it's a genuine population shift, check whether **performance** (or the best proxy) actually moved — input drift without performance impact may not need action. (3) Check **which direction** and whether it pushes cases across the decision threshold. (4) If performance/proxy is affected: consider recalibration (if ranking holds), a challenger trained on recent data, a threshold adjustment, or a temporary conservative posture. (5) Document the finding and the decision. Don't auto-retrain on a PSI number alone.
*Why correct:* Investigate-and-localise first (pipeline change vs real shift), check performance impact, then a proportionate response; don't auto-retrain.
*Common mistakes:* Auto-retraining on the PSI threshold; not checking for a data-pipeline bug; ignoring segment localisation.
*Follow-up:* "How do you tell a pipeline bug from real drift?" / "Input drifted but performance is fine — do you act?"

### Advanced (10)

**A1. Q: Design the feature platform and its skew defences for a real-time fraud system, given the §4 incident.**
*Ideal answer:* **One definition, two stores**: transformation logic authored once, materialised to the offline store (point-in-time correct, for training/backtest) and driving the online store (streaming aggregates + KV, single-digit-ms serving). **State durability**: streaming-aggregate state is checkpointed and restored across deploys/restarts; on any cold start, **backfill aggregates from the offline store before the instance joins the scoring pool**. **Coverage signal**: every windowed feature carries how many days it actually reflects; the scoring service treats an under-covered feature as **missing** (trained missing-value handling + conservative fallback), never as a valid low value. **Production skew detector**: continuously sample scored entities, recompute features offline, alert when online-vs-offline divergence exceeds a per-feature bound; a firing detector auto-rolls-back the triggering deploy or holds the service conservative. **Feature-vector logging** for every scoring event (for the detector, for audit, for adverse-action). **Deploy-correlated monitoring**: catch-rate and score PSI sliced by minutes-since-deploy. **Freshness SLAs** per feature. **Governance**: each feature owned, versioned, lineage-tracked, prohibited-proxy-reviewed.
*Why correct:* Shared definitions, durable/backfilled state, coverage-signal-as-missing, a standing skew detector with auto-response, feature-vector logging, deploy-correlated slicing.
*Common mistakes:* Verifying parity only at steady state; treating a cold feature as a valid value; no production skew detector.
*Follow-up:* "Why is 'treat under-covered as missing' better than 'use the low value'?" / "How does the skew detector's bound get set?"

**A2. Q: A credit model's real performance can't be known for 12 months. Design the monitoring and the decision policy for that window.**
*Ideal answer:* **Leading indicators, pre-registered with floors**: score-distribution PSI, approval/decline rate, override rate, application-mix shift, and — as partial signal accrues — **early-payment default** (default in the first 3–6 months) and **vintage curves** (each origination cohort's delinquency at 3/6/9 months vs prior cohorts at the same age). **Slice by segment** (channel, product, geography, thin-file vs thick-file). **Benchmarks**: a challenger and/or a simple reference model scored in shadow for comparison. **Decision policy**: a sustained breach of a proxy floor (e.g. EPD for two consecutive cohorts materially above the prior trend, not explained by a known mix change) triggers a graded response — investigate → tighten a policy overlay / adjust the cutoff → promote a challenger trained on recent data → hold new originations in the affected segment. Explicitly **do not** wait for the 12-month labels to act; document each decision and its rationale for validation/audit. Recalibrate (not necessarily retrain) if ranking holds but the base rate moved.
*Why correct:* Pre-registered proxies with floors + vintage curves + EPD + segment slicing + benchmarks + a graded act-on-proxy decision policy + document.
*Common mistakes:* Only aggregate approval rate; "wait for labels"; no graded response; no segment view.
*Follow-up:* "EPD is up but so is the sub-prime mix — is that a model problem?" / "When do you recalibrate vs retrain?"

**A3. Q: How do you scale independent model validation when there are 5× more models than validators?**
*Ideal answer:* (1) **Materiality tiering** — spend deep validation only where the stakes justify it; low-tier models get a proportionate lightweight review. (2) **Validate the platform once** — the feature store's point-in-time correctness, the training-pipeline reproducibility, the drift-monitoring templates, the fairness-test suite — so individual models inherit that assurance instead of re-proving it. (3) **Reusable validation components** — standard test batteries (stability, disparate impact, sensitivity, benchmark), a standard documentation template, a standard monitoring-plan template. (4) **Shift left** — engage validators during design so challenge shapes the model and there's less end-of-line rework. (5) **Risk-based sampling for revalidation** — trigger-driven plus tier-scheduled, not everything every year. (6) **Tooling** — automate the mechanical parts (metric computation, drift reports, documentation assembly) so validators spend time on judgement, not spreadsheets. (7) A **findings backlog with prioritisation** so the scarce capacity goes to the highest risk.
*Why correct:* Tiering + validate-the-platform + reusable components + shift-left + risk-based revalidation + tooling + prioritised backlog.
*Common mistakes:* "Hire more validators" as the only answer; validating every model to the same depth.
*Follow-up:* "What exactly does 'validate the platform' cover?" / "How do you decide a model is low-tier?"

**A4. Q: A GenAI feature drafts suspicious-activity narrative summaries that AML analysts review and file. Is this a 'model' under MRM, what tier, and what does validation look like?**
*Ideal answer:* Yes — it processes inputs into an output that informs a regulatory filing, so it's in scope. **Tier**: it doesn't auto-decide (an analyst reviews and files), which lowers it, but SAR quality and timeliness are regulator-sensitive and a systematically biased summary could cause missed or misfiled SARs, which raises it — likely **medium-high**, and the tiering rationale must be documented and defensible. **Validation**: conceptual soundness — is an LLM appropriate for narrative synthesis, what are its known failure modes (hallucinated facts, omitted material facts, tone), what's the human-review design and does it actually catch errors (test the reviewers, not just the model). Ongoing monitoring — a golden-set + calibrated-judge regime (Module 184) on faithfulness (every claim traceable to case evidence) and completeness (material facts not omitted), plus production sampling of filed vs draft narratives and analyst edit rates. Outcomes analysis — QA sampling of filed SARs, feedback from regulators/FIU, false-negative review. Guardrails — the summary is grounded strictly in retrieved case data, no free-form assertion; PII handling; the model version pinned; change notice from the vendor. Documented limitations and a use restriction: "draft only; analyst is the filer and is accountable."
*Why correct:* In scope, defensible medium-high tiering with rationale, validation across all three pillars adapted to GenAI, guardrails, and an explicit use restriction.
*Common mistakes:* "It's just a summariser, not a model"; validating the model but not the human-review effectiveness.
*Follow-up:* "How do you test whether the analysts actually catch the model's errors?" / "What would make you not deploy this at all?"

**A5. Q: Champion/challenger for a credit model: the challenger has a higher Gini on the last 6 months of data. Do you promote it? What else must you check?**
*Ideal answer:* Not on Gini alone. Check: (1) **Statistical significance** of the Gini difference (paired, with a CI), not a point estimate — and on data whose labels are actually mature enough. (2) **Segment performance** — does the challenger win everywhere, or does it gain overall while regressing thin-file / protected-class-adjacent / a key product segment? (3) **Fairness** — disparate-impact metrics for the challenger must not regress; a Gini gain achieved by leaning on a protected-attribute proxy is disqualifying. (4) **Stability** — score-distribution stability, calibration (are predicted PDs accurate, not just rank-ordered). (5) **Explainability quality** — can it still produce faithful adverse-action reasons. (6) **Operational** — latency, feature dependencies, cost. (7) **Validation** — a challenger making real credit decisions needs tier-appropriate independent validation before promotion. (8) **The comparison window** — 6 months isn't a full outcome window; EPD and vintage curves, not final default, so weight accordingly. Promote only if it wins on the primary metric with confidence *and* clears every guardrail *and* is validated.
*Why correct:* Significance + segment + fairness + calibration/stability + explainability + operational + validation + immature-label caveat.
*Common mistakes:* Promoting on aggregate Gini; ignoring fairness and calibration; skipping the challenger's validation.
*Follow-up:* "The challenger wins overall but regresses thin-file applicants — promote?" / "Why check calibration separately from Gini?"

**A6. Q: What is genuinely new about MLOps/MRM risk versus the rest of this domain, and what is a re-instance of a known pattern?**
*Ideal answer:* **Re-instances**: training-serving skew from a steady-state-only parity check is Module 182 §4's "operational property no functional test covers"; aggregate drift monitoring hiding a segment regression is the course-wide "aggregate can't detect a concentrated failure"; the stale-reference-set problem (Module 184 §4) recurs as a stale training-reference distribution for PSI; "we can't reproduce it" is the non-determinism thread. **Genuinely new**: (1) **the label-lag structural gap** — for credit/AML you *cannot* measure the thing you care about for months to years after the decision, so the entire monitoring discipline is built on proxies and the courage to act on them, which no prior module faced. (2) **A legally-mandated independent function** with the authority to block your model — "effective challenge" is an org-design and power question, not a technical one, and no prior module had a regulator requiring a second line. (3) **Fairness as a hard legal gate** on feature selection and outcomes — a modelling choice can be a statutory violation. The synthesis: the *skew and drift-monitoring* failures are familiar engineering shapes, but delayed ground truth, a mandated independent challenger, and fair-lending law make model governance a regulated organisational discipline, not just an engineering one.
*Why correct:* Separates the re-instanced skew/aggregate/staleness failures from the new label-lag gap, the mandated independent function, and fairness-as-legal-gate.
*Common mistakes:* Claiming it's all engineering; missing that label lag changes the whole monitoring philosophy.
*Follow-up:* "How does label lag change what 'monitoring' even means?" / "Why is 'effective challenge' an org-power question?"

**A7. Q: A regulator's exam finds three models running in production that aren't in the model inventory. As the Principal, what's your response — immediate and systemic?**
*Ideal answer:* **Immediate**: assess each — what decisions does it drive, what's the exposure, is there any validation or monitoring, who owns it. For anything material and unvalidated, decide fast whether to keep running with compensating controls (enhanced monitoring, human review, a policy overlay, tighter limits) or to stop using it; document the risk acceptance and who signed it. Register all three now, tier them, and put them in the validation queue with priority. **Systemic**: this is a control failure, not three mistakes. (1) **Discovery** — automated scanning of serving infra, API gateways, batch schedulers, and notebooks-in-prod reconciled against the inventory, run continuously, with a report to the MRM committee. (2) **Prevention** — deploy paths that don't go through the registry are blocked; a model can't reach production without an inventory entry and at least a tier and a monitoring plan. (3) **Definition clarity** — teams didn't register them, often because "is this a model?" was ambiguous; publish clear scoping guidance (the SR 11-7 definition applied to your context, including GenAI). (4) **Culture** — make registration low-friction and make the consequences of shadow models clear. (5) Report the finding, the remediation plan, and dates to the regulator proactively.
*Why correct:* Immediate risk triage + compensating controls + register/tier/queue, then systemic discovery + blocked deploy paths + scoping guidance + friction reduction + proactive regulator communication.
*Common mistakes:* Just registering the three; no discovery mechanism; not blocking non-registry deploy paths; hiding it from the regulator.
*Follow-up:* "How do you build the discovery scan?" / "One of the three is material and unvalidated — keep it running or not?"

**A8. Q: How do you know your MLOps/MRM system itself is degrading — the governance, not a model?**
*Ideal answer:* Trend the meta-signals: (1) **inventory completeness** — discovery-scan hits vs registered models over time; any gap is a red flag. (2) **validation backlog and overdue revalidations** — growing = the second line can't keep up = models running on stale validation. (3) **findings remediation** — open findings past their deadline, and repeat findings (the same issue recurring across models = a systemic gap). (4) **monitoring coverage** — models in production with no active monitoring plan or with alerts that never fire (a monitor that never fires is often broken, not perfect). (5) **skew-detector and drift-alert triage time** and false-positive rate (an ignored alert channel is no alert channel). (6) **time-to-production** for a validated model (if governance adds months, teams route around it). (7) **incidents where "the model was fine but the process failed"** — count them. Review on a cadence with the MRM committee; each is a way the governance, not a model, has decayed.
*Why correct:* Names the governance meta-signals — inventory gap, validation backlog, overdue revalidations, findings aging/recurrence, monitoring coverage, alert-triage health, time-to-prod, process-failure incidents.
*Common mistakes:* Only tracking model metrics; assuming the governance framework is static and healthy.
*Follow-up:* "A monitor that never fires — how do you tell healthy from broken?" / "Validation backlog is growing — levers?"

**A9. Q: A model uses SHAP for adverse-action reasons. Validation flags that the SHAP explanations are 'unstable' — small input changes flip the top reasons. What does this mean and what do you do?**
*Ideal answer:* Instability means the per-decision attributions aren't robust — near a decision boundary or in a region where features interact strongly, tiny perturbations reshuffle which features SHAP credits, so the "principal reasons" you'd give two near-identical applicants could differ materially. That's a Reg B problem (reasons must be accurate and specific) and a conceptual-soundness concern. Options: (1) Use a **more stable attribution method** or configuration (e.g. TreeSHAP with a fixed background dataset, exact rather than sampled, or averaging over a neighbourhood). (2) **Simplify the model** in the regions where it's unstable, or use a **monotonic / constrained GBM** so feature effects are well-behaved and explanations are stable by construction. (3) **Post-process reason codes** to a stable mapping — group correlated features so the *reason* is stable even if the exact feature credited shifts. (4) If instability can't be resolved for a material credit model, that's a validation finding that may **condition or block** the model — an interpretable model (constrained logistic/scorecard) may be the right answer for the regulated decision, with the GBM relegated to non-decisioning use.
*Why correct:* Explains what unstable attributions mean and the Reg B risk, then a ladder — stable method → constrained model → stable reason-code mapping → interpretable model / block.
*Common mistakes:* "SHAP is standard, ship it"; not connecting instability to the legal accuracy requirement.
*Follow-up:* "Why do monotonic constraints help explanation stability?" / "When do you abandon the black-box for a scorecard?"

**A10. Q: The firm wants to use an LLM to make (not just support) a low-value, high-volume decision — e.g. auto-approving small merchant refund disputes. Walk the MRM analysis.**
*Ideal answer:* **Scoping**: it auto-decides, so it's a model driving decisions with customer and financial impact — in scope, and *not* low-tier just because each decision is small (aggregate exposure + complaint/regulatory risk + reputational risk from a systematic error). **Conceptual soundness**: is an LLM the right tool, or is this a rules/tabular problem? Often the honest answer is that the decision *is* mostly rules (amount thresholds, dispute reason codes, merchant history) and the LLM is being used where a deterministic model would be more validatable and explainable — push back. If the LLM genuinely adds value (unstructured evidence interpretation), constrain it: it outputs structured factors, a **deterministic decision surface** combines them, and the LLM never emits the final decision directly. **Explainability**: each decision needs a defensible reason — from the deterministic surface and verifiable evidence, not the LLM's introspection. **Evaluation**: exhaustive golden-set + calibrated-judge + online-assurance (Module 184), sliced, with floors, especially on the "should have been declined" error (asymmetric cost). **Guardrails**: hard limits (max auto-approve amount), injection defence (dispute text is attacker-influenceable), rate anomaly detection, and a sampled human audit. **Monitoring**: auto-approval rate, reversal/complaint rate, and — the label proxy — later chargebacks/fraud on auto-approved disputes. **Fairness**: check for disparate outcomes by merchant segment. **Use restriction**: documented amount ceiling and evidence types in scope; anything else → human. **Validation**: independent, tier-appropriate, with a challenger (a rules baseline). The recommendation is often: use the deterministic model for the decision, the LLM only for evidence extraction inside it.
*Why correct:* Full MRM analysis — scoping/tiering, conceptual-soundness push-back toward rules, constrained decision surface, explainability, rigorous sliced evaluation with asymmetric-error focus, guardrails, proxy monitoring, fairness, use restriction, independent validation with a rules challenger.
*Common mistakes:* Treating it as low-tier; letting the LLM emit the decision; no asymmetric-error focus; no rules challenger.
*Follow-up:* "What's the label proxy for a wrongly auto-approved dispute and how long does it lag?" / "Where's the line where you'd refuse to let the LLM near this?"

### Expert (FinTech Principal Panel)

**E1. Q: Design the firm's ML platform + model-governance operating model so 40+ models across fraud, credit, AML, and pricing ship fast *and* satisfy SR 11-7. Name the two things most likely wrong in 18 months.**
*Ideal answer:* **Platform**: a shared **feature store** (offline point-in-time + online low-latency, one definition, centrally validated for point-in-time correctness, feature governance with prohibited-proxy review); **reproducible training pipelines** (as-code, data-snapshot-hashed, experiment-tracked); a **model registry** carrying governance metadata (validation status, tier, limitations, use restrictions, monitoring plan) that **gates production promotion**; **staged deployment** (shadow → challenger → canary → prod, rollback always); a shared **drift/performance monitoring service** (per-feature PSI sliced by segment, output PSI, proxy indicators with floors, fairness metrics, a skew detector) with a common triage flow; the **evaluation platform** from Module 184 as the eval gate. **Operating model**: three lines of defence with an **independent validation function** engaged **at design time**; **materiality tiering** driving validation depth and revalidation cadence; **reusable validation components** (standard test batteries, doc templates); **validate the platform once** so models inherit it; a **complete model inventory** with automated discovery reconciliation; a **governance committee** approving production use; **findings with deadlines**. **Two likely-wrong in 18 months**: (1) **the validation function becomes the bottleneck** — model supply outpaces validator capacity, backlog grows, models run on stale validation; mitigate with tiering discipline, platform-level validation, reusable components, shift-left, and tooling — and monitor the backlog as a KPI. (2) **the feature store's "one definition" erodes** — teams under deadline pressure add bespoke online feature code that diverges from the offline definition, reintroducing skew; mitigate with the skew detector as a standing gate, feature ownership, and blocking non-store feature paths.
*Why correct:* Complete platform + operating model at the right altitude, with two specific, well-chosen future-wrong items and mitigations.
*Common mistakes:* Only the platform, no operating model; no discovery reconciliation; treating validation capacity as infinite.
*Follow-up:* "How do you keep validation off the critical path?" / "How do you enforce 'one feature definition' technically?"

**E2. Q: An auditor asks you to demonstrate that a material credit model is appropriately governed end to end. What do you show?**
*Ideal answer:* (1) **Inventory entry** — the model, its owner, materiality tier and the tiering rationale, validation status and dates. (2) **Development documentation** — the problem statement, data sources and the training-data snapshot hash, feature list with lineage and the prohibited-attribute/proxy review, methodology and assumptions, the reproducible pipeline definition. (3) **The independent validation report** — conceptual soundness (methodology fit, variable selection, assumptions), outcomes analysis (back-testing, benchmarking against a challenger, sensitivity), the ongoing-monitoring plan, disparate-impact testing results, and any conditions/findings with remediation status. (4) **Evidence of effective challenge** — that validation was engaged at design, raised issues, and got changes made (not a rubber stamp). (5) **Governance committee approval** for the model's use, with the documented use restrictions and limitations. (6) **Monitoring evidence** — the live drift/proxy dashboards (score PSI, EPD, vintage curves, approval rate, fairness metrics) sliced by segment, the alert thresholds, and the triage log showing breaches were investigated. (7) **Adverse-action evidence** — sample decline notices with reason codes and proof they faithfully reflect the model's per-applicant attributions. (8) **Change history** — retrains, recalibrations, and revalidations, each with its trigger, evidence, and approval. (9) **The revalidation schedule** and the last/next dates. The narrative: inventoried, tiered, built reproducibly with governed features, independently and effectively challenged, approved for a defined use, monitored on proxies with floors while labels mature, explainable in a Reg-B-compliant way, and revalidated on a cadence.
*Why correct:* A complete, ordered end-to-end governance evidence package spanning inventory, development, validation + effective challenge, approval, monitoring, adverse action, change history, and revalidation.
*Common mistakes:* Showing the validation report only; no evidence challenge was "effective"; no monitoring triage log; no adverse-action faithfulness evidence.
*Follow-up:* "Show me where validation changed the model." / "Your last full outcomes analysis was 14 months ago — defend that."

**E3. Q: A drift alert on a fraud model's key feature was dismissed as 'seasonality' three times over two months by the on-call rota. Then fraud losses spiked and the root cause was real concept drift (a new fraud pattern) the whole time. Walk the analysis and the systemic fix.**
*Ideal answer:* **What happened**: a real signal was repeatedly classified as benign noise because (a) "seasonality" is an available, unfalsifiable explanation that ends the investigation, (b) the alert had no attached context (which segment, magnitude vs history, correlated metrics) to make dismissal hard, (c) on-call rotates, so no one saw the *pattern of repeated alerts* — each was a fresh, isolated event, (d) there was no floor that forced escalation regardless of the on-call's judgement, and (e) fraud labels lag, so the confirming performance signal came late. This is the domain's "a check whose dismissal is easier than its investigation" plus the aggregate/isolated-event blindness. **Systemic fix**: (1) **Alerts carry evidence** — segment localisation, magnitude vs the seasonal baseline (compare to the same period last year, not a flat reference), correlated metrics, and a link to the prior N occurrences. (2) **Repeated-alert escalation** — the 2nd or 3rd occurrence of the same alert within a window auto-escalates to the model owner and the fraud team, bypassing on-call discretion. (3) **A hard floor** — a drift magnitude or a proxy (chargeback rate, review-queue rate) that, if breached, forces a challenger evaluation or a conservative threshold, regardless of the "it's seasonality" narrative — the narrative must be *proven* (show the seasonal baseline it matches), not asserted. (4) **Ownership** — model drift alerts go to the model owner, not a generic infra rota, because judging them needs model context. (5) **Post-incident**: recalibrate the seasonal baselines; add the new fraud pattern to the training data and the eval set; review other models for the same alert-fatigue risk. (6) Track alert dismissal reasons and revisit "seasonality" dismissals when labels arrive.
*Why correct:* Diagnoses the unfalsifiable-explanation + rotating-on-call + no-pattern-visibility + no-floor failure, and fixes it with evidence-rich alerts, repeated-alert auto-escalation, a proven-not-asserted seasonality bar, a hard floor, model-owner routing, and a dismissal-reason audit.
*Common mistakes:* "Tell on-call to take alerts seriously"; adding more alerts; no floor that overrides judgement.
*Follow-up:* "How do you make 'it's seasonality' a falsifiable claim?" / "Why route drift alerts to the model owner not infra on-call?"

**E4. Q: Make the case to a skeptical business head for investing in MLOps/MRM infrastructure when the pressure is to ship more models faster.**
*Ideal answer:* Frame it as the thing that makes shipping models fast *sustainable and legal*. Without it: every model is a bespoke project (slow), training-serving skew and drift are found by losses not dashboards, the validation function is a months-long bottleneck that teams route around (creating shadow models — a regulatory finding waiting to happen), and one material model failure or a fair-lending issue becomes an MRA, a consent order, remediation costs, and a hard cap on model deployment that stops *all* the fast shipping. With it: a feature store and reproducible pipelines cut model build time; a registry + staged deployment + shared monitoring make each model's go-live routine instead of bespoke; validating the platform once and reusable validation components take validation off the critical path; a complete inventory and automated monitoring mean issues are caught in dashboards, cheaply. Quantify: current per-model build time × model count, losses attributable to skew/drift incidents, the cost and duration of the last regulatory finding in this space (industry examples if not internal), validator time spent re-proving platform properties. Propose a scoped platform + operating-model investment with a 2-quarter deliverable and KPIs: model time-to-production, validation backlog, inventory completeness, drift-incidents-caught-pre-loss. It's the same argument as CI/CD: the infrastructure that lets you go fast without breaking things — here, "breaking things" includes the regulator.
*Why correct:* Reframes as sustainable+legal velocity, names the shadow-model/regulatory-finding tail risk, quantifies, proposes a scoped deliverable with KPIs, uses the CI/CD analogy.
*Common mistakes:* Framing as pure compliance cost; no quantification; ignoring that a finding caps all future velocity.
*Follow-up:* "What KPI proves the investment worked in two quarters?" / "Minimum viable version with a small team?"

**E5. Q: Give the single most discriminating interview question you'd ask a Principal candidate about ML in a regulated firm, and contrast a strong and weak answer.**
*Ideal answer:* Question: **"Your fraud model has great offline metrics and it's been in production a month. How confident are you that it's actually working, and how do you know?"** A **weak** answer cites the offline metrics and says "we'd see it in the AUC" — not realising fraud labels lag, not mentioning training-serving skew, treating offline performance as production performance. A **strong** answer is immediately skeptical of offline metrics as evidence of production behaviour: has it been checked for training-serving skew (log the production feature vectors, recompute offline, compare — especially through deploys and restarts)? Is drift monitored per feature *and per segment*, not just aggregate? Are the labels even mature enough to measure recall yet, and what proxies (chargeback rate, review-queue rate, score PSI) are being watched with floors in the meantime? Is there a challenger for comparison? Are we watching for deploy-correlated regressions? Is the model in the inventory with a monitoring plan and a validation status? The tell: a strong candidate knows offline metrics don't establish production performance, that the dangerous failures are skew and segment-concentrated drift with a label lag hiding them, and that "how do you know" is answered with skew detection + sliced monitoring + proxies with floors + a challenger — not "the metrics are good."
*Why correct:* The question forces the candidate to distrust offline metrics and confront label lag and skew; the contrast identifies "we'd see it in the AUC" as the weak tell.
*Common mistakes (weak answer):* Trusting offline metrics; not mentioning skew, segment slicing, label lag, or proxies.
*Follow-up:* "The labels won't be mature for weeks — so what's your evidence today?" / "How would skew show up here specifically?"

---

## 11. Coding Exercises

### Easy — PSI (population stability index) per feature with alerting

**Problem.** Implement `psi(reference, current, bins)` and a `check_drift` that computes PSI per feature against a stored reference and returns findings above thresholds (0.1 = minor, 0.25 = significant).

```python
import math
from dataclasses import dataclass

@dataclass
class DriftFinding:
    feature: str
    psi: float
    severity: str

def _bin_edges(values: list[float], bins: int) -> list[float]:
    s = sorted(values)
    return [s[min(len(s) - 1, int(i * len(s) / bins))] for i in range(bins)] + [s[-1] + 1e-9]

def _hist(values: list[float], edges: list[float]) -> list[float]:
    counts = [0] * (len(edges) - 1)
    for v in values:
        for i in range(len(edges) - 1):
            if edges[i] <= v < edges[i + 1]:
                counts[i] += 1
                break
    n = len(values) or 1
    return [c / n for c in counts]

def psi(reference: list[float], current: list[float], bins: int = 10) -> float:
    edges = _bin_edges(reference, bins)
    r = _hist(reference, edges)
    c = _hist(current, edges)
    total = 0.0
    for ri, ci in zip(r, c):
        ri = max(ri, 1e-6); ci = max(ci, 1e-6)     # avoid div/log 0
        total += (ci - ri) * math.log(ci / ri)
    return total

def check_drift(reference: dict[str, list[float]], current: dict[str, list[float]],
                minor: float = 0.1, significant: float = 0.25) -> list[DriftFinding]:
    out = []
    for feat, ref in reference.items():
        if feat not in current:
            continue
        p = psi(ref, current[feat])
        if p >= significant:
            out.append(DriftFinding(feat, round(p, 4), "SIGNIFICANT"))
        elif p >= minor:
            out.append(DriftFinding(feat, round(p, 4), "MINOR"))
    return sorted(out, key=lambda f: -f.psi)
```

*Time:* O(n·bins) per feature. *Optimised:* precompute reference bin edges once and store them (recomputing edges from the reference every run is wasteful and non-reproducible); compute PSI per segment, not just globally (the §E3 lesson); compare `current` to a **seasonally-matched** reference (same period prior year) not a flat one, so seasonality isn't misread as drift; emit the top drifting features by model-importance weight, not raw PSI.

### Medium — Point-in-time correct feature join (prevent label leakage)

**Problem.** Given labelled events (`entity_id`, `label_ts`, `label`) and a feature history (`entity_id`, `feature_ts`, `value`), build a training frame where each row's feature is the **latest value strictly before `label_ts`** — never a later one.

```python
from bisect import bisect_left
from dataclasses import dataclass

@dataclass
class LabelEvent:
    entity_id: str
    label_ts: int
    label: int

@dataclass
class FeaturePoint:
    entity_id: str
    feature_ts: int
    value: float

def point_in_time_join(labels: list[LabelEvent], feats: list[FeaturePoint],
                       max_staleness: int | None = None) -> list[dict]:
    # index feature history per entity, sorted by ts
    hist: dict[str, list[tuple[int, float]]] = {}
    for fp in feats:
        hist.setdefault(fp.entity_id, []).append((fp.feature_ts, fp.value))
    for e in hist:
        hist[e].sort()

    rows = []
    for le in labels:
        series = hist.get(le.entity_id, [])
        ts_list = [t for t, _ in series]
        # latest feature strictly BEFORE label_ts
        idx = bisect_left(ts_list, le.label_ts) - 1
        if idx < 0:
            value, feat_ts = None, None                     # no feature known yet -> missing
        else:
            feat_ts, value = series[idx]
            if max_staleness is not None and le.label_ts - feat_ts > max_staleness:
                value = None                                 # too stale to trust -> missing
        rows.append({"entity_id": le.entity_id, "label_ts": le.label_ts,
                     "label": le.label, "feature_value": value, "feature_ts": feat_ts})
    return rows

def _selftest():
    labels = [LabelEvent("a", 100, 1), LabelEvent("a", 50, 0)]
    feats = [FeaturePoint("a", 30, 1.0), FeaturePoint("a", 70, 2.0), FeaturePoint("a", 120, 9.0)]
    rows = point_in_time_join(labels, feats)
    assert rows[0]["feature_value"] == 2.0   # label at 100 -> uses ts=70, NOT ts=120 (future!)
    assert rows[1]["feature_value"] == 1.0   # label at 50  -> uses ts=30
```

*Complexity:* O(F log F) to sort + O(L log F) for the joins. *Optimised:* for many features, do a merge-join over time-sorted streams; enforce `strictly before` (not `<=`) to avoid same-timestamp leakage; carry a `feature_ts` column into training so a validator can audit the temporal cut; treat "no feature before label_ts" as the model's trained missing-value case, not zero.

### Hard — Training-serving skew detector

**Problem.** Given logged production scoring events (`entity_id`, `score_ts`, `online_features: dict`) and access to an offline recompute function, sample events, recompute features as-of `score_ts`, and report per-feature skew (fraction of samples where relative divergence exceeds a bound), flagging features over a skew-rate threshold.

```python
from dataclasses import dataclass
from statistics import median

@dataclass
class ScoringEvent:
    entity_id: str
    score_ts: int
    online_features: dict[str, float]

@dataclass
class SkewFinding:
    feature: str
    skew_rate: float          # fraction of samples diverging beyond the bound
    median_rel_diff: float
    severity: str

def detect_skew(events: list[ScoringEvent], offline_recompute,   # (entity_id, ts) -> dict[str,float]
                rel_bound: float = 0.10, skew_rate_alert: float = 0.02,
                sample: int = 2000) -> list[SkewFinding]:
    import random
    sampled = events if len(events) <= sample else random.sample(events, sample)

    per_feat_diffs: dict[str, list[float]] = {}
    per_feat_exceed: dict[str, int] = {}
    per_feat_n: dict[str, int] = {}

    for ev in sampled:
        offline = offline_recompute(ev.entity_id, ev.score_ts)
        for feat, on_val in ev.online_features.items():
            off_val = offline.get(feat)
            if off_val is None:
                continue
            denom = abs(off_val) if abs(off_val) > 1e-9 else 1e-9
            rel = abs(on_val - off_val) / denom
            per_feat_diffs.setdefault(feat, []).append(rel)
            per_feat_n[feat] = per_feat_n.get(feat, 0) + 1
            if rel > rel_bound:
                per_feat_exceed[feat] = per_feat_exceed.get(feat, 0) + 1

    findings = []
    for feat, n in per_feat_n.items():
        rate = per_feat_exceed.get(feat, 0) / n
        if rate >= skew_rate_alert:
            sev = "HIGH" if rate >= 5 * skew_rate_alert else "MEDIUM"
            findings.append(SkewFinding(feat, round(rate, 4),
                                        round(median(per_feat_diffs[feat]), 4), sev))
    return sorted(findings, key=lambda f: -f.skew_rate)
```

*Complexity:* O(sample · features) plus the recompute cost. *Optimised:* run continuously on a rolling sample; slice the skew rate by **time-since-last-deploy** so the §4 post-deploy cold-window pattern is visible; alert-and-auto-rollback on a HIGH finding correlated with a recent deploy; store the raw (online, offline) pairs for the worst features for debugging; weight features by model importance so a skew on a top-10 feature pages louder than one on a rarely-used feature.

### Expert — Champion/challenger promotion decision harness

**Problem.** Decide whether to promote a challenger model given: paired scores + (mature) labels for both on a comparison set, a primary metric, guardrail metrics (fairness gap, calibration error, latency), and a required significance level. Return PROMOTE / HOLD / REJECT with reasons.

```python
import random
from dataclasses import dataclass, field
from statistics import mean

@dataclass
class Decision:
    verdict: str                       # PROMOTE | HOLD | REJECT
    reasons: list[str] = field(default_factory=list)

def _auc(scores: list[float], labels: list[int]) -> float:
    pos = [s for s, y in zip(scores, labels) if y == 1]
    neg = [s for s, y in zip(scores, labels) if y == 0]
    if not pos or not neg:
        return 0.5
    wins = sum(1 for p in pos for n in neg if p > n) + 0.5 * sum(1 for p in pos for n in neg if p == n)
    return wins / (len(pos) * len(neg))

def _bootstrap_auc_delta(ch, champ, labels, iters=2000, seed=0):
    rng = random.Random(seed)
    n = len(labels)
    deltas = []
    for _ in range(iters):
        idx = [rng.randrange(n) for _ in range(n)]
        deltas.append(_auc([ch[i] for i in idx], [labels[i] for i in idx])
                      - _auc([champ[i] for i in idx], [labels[i] for i in idx]))
    deltas.sort()
    return deltas[int(0.025 * iters)], deltas[int(0.975 * iters)]

def evaluate_challenger(champ_scores, chal_scores, labels,
                        segments: list[str],
                        guardrails: dict,          # {"fairness_gap": val, "cal_error": val, "latency_ms": val}
                        guardrail_limits: dict,
                        min_effect: float = 0.005) -> Decision:
    d = Decision("REJECT")
    lo, hi = _bootstrap_auc_delta(chal_scores, champ_scores, labels)

    if lo <= 0:
        d.reasons.append(f"primary metric not significantly better (AUC delta 95% CI [{lo:.4f},{hi:.4f}])")
        d.verdict = "HOLD" if hi > min_effect else "REJECT"
        return d
    if (lo + hi) / 2 < min_effect:
        d.reasons.append(f"improvement below min effect size ({(lo+hi)/2:.4f} < {min_effect})")
        d.verdict = "HOLD"
        return d

    # guardrails — any breach blocks promotion regardless of the primary metric
    breaches = [k for k, v in guardrails.items() if v > guardrail_limits.get(k, float("inf"))]
    if breaches:
        d.reasons.append(f"guardrail breach: {breaches}")
        d.verdict = "REJECT"
        return d

    # segment check — challenger must not regress any segment's AUC materially
    seg_regressions = []
    for seg in set(segments):
        idx = [i for i, s in enumerate(segments) if s == seg]
        if len(idx) < 50:
            continue
        ch_a = _auc([chal_scores[i] for i in idx], [labels[i] for i in idx])
        cm_a = _auc([champ_scores[i] for i in idx], [labels[i] for i in idx])
        if ch_a < cm_a - 0.01:
            seg_regressions.append((seg, round(ch_a - cm_a, 4)))
    if seg_regressions:
        d.reasons.append(f"segment regressions: {seg_regressions}")
        d.verdict = "HOLD"
        return d

    d.verdict = "PROMOTE"
    d.reasons.append(f"AUC delta CI [{lo:.4f},{hi:.4f}] > 0, effect >= {min_effect}, "
                     f"guardrails clear, no segment regression")
    return d
```

*Complexity:* the naive AUC is O(pos·neg) — use a sorted-rank AUC for O(n log n); bootstrap is O(iters·n log n). *Optimised:* add a **label-maturity check** (reject the comparison if labels aren't mature enough for the metric — §A5), a **fairness-gap significance test** not just a point value, a **calibration** check (reliability curve, not just error), and require the challenger to carry its own tier-appropriate **validation status** before PROMOTE is even considered. The structural point: a guardrail breach or a segment regression forces HOLD/REJECT regardless of how good the aggregate primary metric is — the aggregate can't buy back a concentrated regression.

---

## 12. System Design — A Bank's ML Platform: Feature Store, Registry, Drift Monitoring & Model-Risk Governance

*(Four-step Pragmatic Engineer spine.)*

### Step 1 — Understand the problem and establish design scope

**Candidate ↔ interviewer dialogue**

> **Q:** Platform for what kind of models?
> **A:** Tabular decision models — fraud (real-time), credit (batch + real-time), AML monitoring, pricing. 40+ models, growing. Plus a few GenAI support tools that inherit the governance.
> **Q:** Are we designing the training frameworks?
> **A:** No — assume standard training tools. Design the feature store, the registry, the deployment path, the monitoring, and how the model-risk governance (SR 11-7) is wired into all of it.
> **Q:** Real-time serving latency?
> **A:** Fraud scoring is in the card-authorisation path — ~35 ms total budget, so features must return in single-digit ms.
> **Q:** What's the regulatory frame?
> **A:** US bank under SR 11-7: independent model validation, model inventory, materiality tiering, periodic revalidation, adverse-action (Reg B) for credit, fair-lending testing. Assume UK/EU equivalents apply to some entities.
> **Q:** In scope: feature store (offline + online), training-pipeline reproducibility hooks, model registry with governance metadata, staged deployment, drift/performance/proxy monitoring, the skew detector, the model inventory + validation workflow integration, fairness testing. Out: the training frameworks, the eval platform internals (Module 184 — consumed as a gate), the GenAI serving stack (Module 182).
> **Q:** What does "done" look like for a model?
> **A:** Inventoried, tiered, built from governed features via a reproducible pipeline, independently validated, committee-approved for a defined use, deployed via canary with rollback, and monitored with proxy floors and a revalidation date.

**Functional requirements**

- Feature store: author a feature definition once → materialise to an offline store (point-in-time correct) and an online store (single-digit-ms serving); feature lineage, ownership, versioning, and a prohibited-attribute/proxy review gate on onboarding.
- Log the full feature vector for every production scoring event.
- Skew detector: sample scoring events, recompute features offline as-of the score time, alert on divergence; slice by time-since-deploy.
- Model registry: store artefact + lineage + governance metadata (validation status, tier, limitations, use restrictions, monitoring plan, approver); gate production promotion on `validated` + committee approval.
- Staged deployment: shadow → challenger → canary → prod, rollback always; challenger scoring + comparison harness.
- Monitoring: per-feature PSI (segment-sliced, seasonally-referenced), output/score PSI, performance as labels arrive, proxy indicators (EPD, vintage curves, approval/override rate) with pre-registered floors, fairness metrics, feature freshness/coverage.
- Model inventory: complete, with automated discovery reconciliation against serving infra; block deploy paths that bypass the registry.
- Validation workflow: tier → validation queue → validation report → conditions/findings with deadlines → committee approval → revalidation schedule (tier-driven + event-triggered).
- Adverse-action: per-decision attribution → faithful reason codes for credit declines.

**Non-functional requirements**

- Online feature retrieval p99 ≤ ~5 ms; hard timeout with a defined conservative fallback (never block the authorisation).
- Point-in-time correctness in every offline join — validated centrally, once.
- Fail-closed governance: no production without an inventory entry, a tier, a monitoring plan, `validated` status, and committee approval.
- Reproducibility: a validator can regenerate a model from the pipeline definition + data snapshot within a documented tolerance.
- Auditability: every model reconstructable to inputs, validation, approvals, monitoring history, and change history.

**Back-of-the-envelope estimation**

- Fraud scoring: card authorisations at, say, 5,000 TPS peak; each needs ~400 features ⇒ ~2M feature reads/s from the online store — a partitioned low-latency KV store, features denormalised per entity, batched multi-get. This is the one genuinely high-throughput path.
- Credit/AML/pricing: batch or lower-rate real-time — thousands/s at most; not a throughput challenge.
- Offline store: point-in-time joins over ~5 years × ~50M entities × ~2,000 features for training-set materialisation — a heavy but periodic warehouse/Spark job, partitioned by time.
- Monitoring: 40 models × ~500 monitored features × segment slices × daily PSI + weekly full sweep ⇒ meaningful but schedulable compute; sample and prioritise.
- Skew detector: ~2,000 sampled scoring events/run × offline recompute — modest, continuous.
- Validation: 40 models, tier-driven — maybe 8 high-tier (deep, annual), 15 medium, 17 low; the validator team is the scarce resource, not compute.

**What the numbers tell you the hard problem is.** Only the **fraud feature-serving path** is a throughput problem (~2M reads/s) and it's a solved shape (partitioned KV, denormalised, multi-get, timeout+fallback). Everything else is low-volume. The hard problems are: (1) **offline/online feature consistency** — one definition, point-in-time correctness, and a standing skew detector that catches operational divergence (cold state, staleness) *through deploys*, because that's where "great offline, bad prod" comes from (§4); (2) **monitoring under label lag** — for credit the outcome isn't known for a year, so the whole monitoring discipline is pre-registered proxies with floors, segment-sliced, seasonally-referenced, and *acted on*; (3) **wiring MRM in without it being a bottleneck or a rubber stamp** — a complete inventory with discovery reconciliation, materiality tiering, validate-the-platform-once, reusable validation components, and validators engaged at design. It's a data-consistency and governance platform with one high-throughput serving path bolted on.

### Step 2 — Propose a high-level design and get buy-in

**Component glossary**

- **Feature Registry & Transform Engine** — one place to author a feature (transformation logic + owner + lineage + prohibited-proxy review status); compiles the definition to both an offline materialisation job and an online update path.
- **Offline Feature Store** — historical values on a partitioned lakehouse/warehouse; serves point-in-time-correct training-set materialisation via as-of joins; centrally validated for point-in-time correctness.
- **Online Feature Store** — low-latency partitioned KV store; per-entity denormalised feature rows; streaming-aggregate updater with **checkpointed state** and **offline backfill on cold start**; each feature carries a **coverage/freshness signal**.
- **Scoring Service** — features + model → score; logs the full feature vector per event; treats an under-covered feature as missing (trained handling + conservative fallback); hard feature-fetch timeout.
- **Skew Detector** — samples scoring events, recomputes features offline as-of score time, alerts on per-feature divergence, sliced by time-since-deploy; a HIGH finding correlated with a deploy auto-rolls-back or holds conservative.
- **Model Registry** — artefact + lineage + governance metadata + deployment state; production promotion gated on `validated` + committee approval.
- **Deployment Controller** — shadow → challenger → canary → prod with rollback; runs the champion/challenger comparison harness (Expert exercise).
- **Monitoring Service** — per-feature PSI (segment-sliced, seasonally-referenced), output PSI, performance-as-labels-arrive, proxy indicators with floors (EPD, vintage curves, approval/override), fairness metrics, feature freshness; a common triage flow with repeated-alert auto-escalation to the model owner (§E3).
- **Model Inventory & Discovery** — the authoritative list; an automated scanner reconciles serving infra / gateways / schedulers against it; non-registry deploy paths are blocked.
- **Validation Workflow** — tier assignment → validation queue → validation report (conceptual soundness / ongoing monitoring / outcomes analysis) → findings with deadlines → committee approval → revalidation schedule; reusable test batteries (fairness, stability, sensitivity, benchmark).
- **Explainability Service** — per-decision SHAP attributions → reason-code mapping for adverse-action notices; attribution-drift monitoring.

**Architecture diagram** — see §3.

**End-to-end walkthrough — a new credit model goes live**

1. Modeller authors features in the **Feature Registry**; each passes a prohibited-attribute/proxy review; definitions compile to offline + online paths.
2. Training set is materialised from the **Offline Store** via as-of joins (point-in-time correct); the data snapshot is hashed; the pipeline runs as code with experiment tracking.
3. The model is registered in the **Model Registry** with full lineage; tier = **high** (drives material credit decisions) with a documented rationale; status = `not validated`.
4. **Validation Workflow**: independent validators — engaged since design — run conceptual soundness (methodology, variable selection, assumptions), disparate-impact testing (reusable battery), outcomes analysis (back-test + benchmark vs a scorecard challenger), and agree the ongoing-monitoring plan (score PSI, EPD, vintage curves, fairness, per segment, with floors). Two findings raised, remediated; report issued; status → `validated with conditions`.
5. **Governance committee** approves the model for a defined use (originations in products A/B, not C) with documented limitations; revalidation set for 12 months + event triggers.
6. **Deployment Controller**: shadow for 4 weeks (score distribution + feature behaviour vs the incumbent), then challenger on 10% of decisions with the comparison harness (Expert exercise — guardrails + segment checks), then canary, then full — rollback available throughout.
7. **Scoring Service** serves it; every decision logs its feature vector; declines get **SHAP-derived reason codes** via the Explainability Service.
8. **Monitoring Service** runs the agreed plan; the **Skew Detector** watches offline/online feature parity through deploys; a repeated PSI alert on a segment auto-escalates to the model owner.
9. At month 12 (or on a trigger — EPD breach, a data-source change, a new product), **revalidation** re-runs the pillars; findings and approval recorded.

**REST API (platform)**

`POST /v1/features` — `{name, transform, entity, owner, source_lineage}` → runs the prohibited-proxy review gate → `{feature_id, version, review_state}`.
`POST /v1/training-sets` — `{feature_versions[], entity_set, label_source, as_of_policy}` → point-in-time-correct materialised set + `snapshot_sha256`.
`POST /v1/models` — `{artifact_uri, sha256, lineage, proposed_tier}` → registry entry, status `not_validated`.
`POST /v1/models/{id}/validation` — validators attach the report, conditions, findings; sets `validated | validated_with_conditions | rejected`.
`POST /v1/models/{id}/promote` — `{target: shadow|challenger|canary|production}` → `409` for `production` unless status is validated *and* a committee approval record exists.
`GET /v1/models/{id}/monitoring` → drift, proxy, fairness dashboards + triage log.
`POST /v1/decisions/{id}/adverse-action` → `{reason_codes[]}` from the Explainability Service.
`GET /v1/inventory/reconciliation` → discovered-but-unregistered models (should be empty).

**Data model**

`feature`
| Column | Type | Description |
|---|---|---|
| `id` / `version` | text | |
| `transform_ref` | text | Compiled to offline + online; **one definition** |
| `owner` | text | |
| `lineage` | jsonb | source systems, derivation |
| `proxy_review_state` | text | `PENDING → APPROVED \| REJECTED` (prohibited-attribute proxy check) |
| `freshness_sla_s` | int | |

`model`
| Column | Type | Description |
|---|---|---|
| `id` / `version` | text | |
| `lineage` | jsonb | code version, `training_snapshot_sha256`, feature versions, hyperparams, env |
| `materiality_tier` | text | `low \| medium \| high` + `tier_rationale` |
| `validation_state` | text | `not_validated \| validated_with_conditions \| validated \| rejected` |
| `validation_report_uri` | text | |
| `limitations` / `use_restrictions` | jsonb | |
| `monitoring_plan` | jsonb | metrics, thresholds/floors, cadence, escalation |
| `committee_approval_ref` | text | Required for production |
| `deployment_state` | text | `dev → shadow → challenger → canary → production → retired` |
| `next_revalidation_date` | date | tier-driven; event triggers override |

`scoring_event` (append-only, high volume — partitioned by date, tiered to cold storage)
| Column | Type | Description |
|---|---|---|
| `id` | bigint | |
| `model_version` | text | |
| `entity_id` / `score_ts` | text / timestamptz | |
| `feature_vector` | jsonb | the actual features used (skew detection, audit, adverse-action) |
| `score` / `decision` | float / text | |
| `minutes_since_deploy` | int | for deploy-correlated slicing |

`monitoring_finding`
| Column | Type | Description |
|---|---|---|
| `id` | uuid | |
| `model_version` | text | |
| `kind` | text | `feature_psi \| score_psi \| proxy_floor_breach \| fairness_gap \| skew \| performance` |
| `segment` | text | |
| `detail` | jsonb | magnitude, seasonal baseline, prior occurrences |
| `occurrence_count` | int | repeated-alert escalation trigger |
| `state` | text | `OPEN → INVESTIGATING → RESOLVED \| ESCALATED` |

`model_inventory_reconciliation`
| Column | Type | Description |
|---|---|---|
| `discovered_endpoint` | text | serving path / gateway / schedule |
| `matched_model_id` | text | null ⇒ **shadow model finding** |
| `first_seen` | timestamptz | |

**Status lifecycles**

- Feature: `PENDING → APPROVED → (in use) → DEPRECATED` or `PENDING → REJECTED`.
- Model: `not_validated → validated_with_conditions → validated → (production) → retired`; `→ rejected` blocks use.
- Deployment: `dev → shadow → challenger → canary → production → retired` (rollback = re-`production` the prior version).
- Monitoring finding: `OPEN → INVESTIGATING → RESOLVED | ESCALATED` (2nd/3rd occurrence auto-`ESCALATED`).

**Modelling rationale (inline).** `feature.transform_ref` is **one definition compiled to both stores** — the moment offline and online have separate hand-written logic you have skew (§4). `feature.proxy_review_state` is a **column gating use** so a protected-attribute proxy can't silently enter a model. `model` carries **tier, validation state, limitations, use restrictions, monitoring plan, and committee approval as first-class fields** — the registry is a governance record, and production promotion is a single check against them. `scoring_event.feature_vector` is **logged in full** because training-serving skew and adverse-action faithfulness both require knowing exactly what the model saw, and `minutes_since_deploy` is stored so the §4 deploy-correlated pattern is queryable. `monitoring_finding.occurrence_count` exists specifically so repeated-alert fatigue (§E3) triggers escalation instead of repeated dismissal. `model_inventory_reconciliation` with a nullable `matched_model_id` makes a **shadow model a queryable finding**, not something discovered in an exam.

### Step 3 — Design deep dive

**One feature definition, enforced.** The Feature Registry compiles a single transform to the offline materialisation and the online update path; teams cannot register a model against an online feature that lacks a compiled offline counterpart. Point-in-time correctness of the offline store is **validated once, centrally**, so every model inherits that assurance (the "validate the platform" scaling lever — §A3).

**Skew detection as a standing gate (§4 operationalised).** The Skew Detector runs continuously on a rolling sample: recompute each event's features from the offline pipeline as-of `score_ts`, compare to the logged `feature_vector`, and compute a per-feature skew rate sliced by `minutes_since_deploy`. A HIGH finding within a post-deploy window auto-rolls-back the deploy or holds the Scoring Service at a conservative posture until features are verified warm. Windowed features carry a coverage signal; the Scoring Service maps an under-covered feature to the model's trained missing-value path, never to a plausible-but-wrong low value.

**Monitoring under label lag (the credit reality).** The monitoring plan for a credit model is dominated by **pre-registered proxies with floors** — score-distribution PSI, approval/override rate, EPD (3–6 month), and **vintage curves** (each origination cohort's 3/6/9-month delinquency vs prior cohorts at the same age) — all **segment-sliced** and compared to a **seasonally-matched reference** (same period prior year), not a flat one, so seasonality isn't a get-out-of-jail explanation (§E3). A sustained floor breach triggers a graded response (investigate → policy overlay / cutoff adjustment → challenger → segment hold), acted on *before* the 12-month labels, with each decision documented for validation.

**Alert fatigue countermeasures (§E3).** Findings carry evidence (segment, magnitude vs seasonal baseline, correlated metrics, prior-occurrence links). The 2nd/3rd occurrence of the same finding within a window auto-escalates to the **model owner** (not a generic infra rota — judging model drift needs model context). A "seasonality" dismissal must attach the seasonal baseline it matches (proven, not asserted), and is revisited when labels mature.

**MRM wired in, not bolted on.** Tier is assigned at registration with a documented rationale. The Validation Workflow is a queue with tier-driven SLAs; validators are engaged at design (a hook in the model-proposal step) so challenge shapes the model. Reusable batteries (fairness, stability, sensitivity, benchmark) and a standard report/monitoring-plan template keep validation off the critical path. Production promotion is a hard gate: `validated`(-with-conditions) + a committee approval record + a monitoring plan + an inventory entry, or `409`.

**Inventory completeness (§A7).** The discovery scanner enumerates serving endpoints, API-gateway routes, and batch schedules, and reconciles them against the registry daily; an unmatched endpoint is a `shadow model` finding routed to the MRM committee. Deploy paths that don't originate from a registry promotion are blocked at the infra layer.

**Explainability & fairness.** The Explainability Service computes per-decision SHAP attributions (TreeSHAP, fixed background set for stability — §A9) and maps them to a governed reason-code taxonomy for Reg B adverse-action notices; it also monitors attribution drift (a shift in which features drive decisions is a signal even when PSI on inputs is flat). Disparate-impact testing is a validation gate and a standing monitor.

**Consistency.** The Model Registry, Model Inventory, Feature Registry (proxy-review state), and Validation Workflow state are **CP** — an ungoverned/unvalidated production model or an unreviewed protected-attribute proxy is the worst outcome, so these are strongly consistent and authoritative; promotion reads them strongly. The Online Feature Store trades consistency for latency (bounded staleness, last-write-wins) but with **freshness SLAs and the coverage signal** so the model knows when a feature isn't trustworthy. `scoring_event` ingestion is at-least-once with an idempotency key.

**Failure handling.** Online feature timeout → score with available features + a conservative adjustment, flag the event (never block the authorisation). Skew Detector HIGH + recent deploy → auto-rollback / conservative hold. Offline pipeline non-reproducible → the model can't be promoted (validation blocks). Validation queue overloaded → tier-based prioritisation and a visible backlog KPI (§A8), not silent staleness. Discovery scan finds a shadow model → immediate triage per §A7.

### Step 4 — Wrap-up

**Not covered, and the next questions:**
- The training frameworks and AutoML.
- Deep model-monitoring for the GenAI support tools (Module 184's platform; the LLM-specific evaluation).
- Real-time feature computation infrastructure (stream processing topology, exactly-once aggregation) in depth.
- Cross-jurisdiction model governance (SR 11-7 vs SS1/23 vs TRIM differences and a unified operating model).
- Model-decommissioning and the data-retention story for retired models.
- Economic-scenario / stress-testing model governance (CCAR/DFAST) — a governance regime of its own.
- Bias-mitigation techniques (reweighting, adversarial debiasing, post-processing) and their validation.

**Summary.** A feature store with **one definition** compiled to a point-in-time-correct offline store and a low-latency online store (checkpointed state, backfill-on-cold-start, coverage signals), a **standing skew detector** that reconciles served-vs-recomputed features through deploys, a **model registry** that is a governance record and gates production on validation + committee approval, staged deployment with champion/challenger, **drift/proxy monitoring built for label lag** (pre-registered floors, EPD, vintage curves, segment-sliced, seasonally-referenced, with repeated-alert auto-escalation), a **complete inventory with automated discovery reconciliation**, and an **independent validation workflow** engaged at design with reusable batteries and platform-level validation to stay off the critical path. One high-throughput path (fraud feature serving); everything else is a data-consistency and governance problem — and the recurring failure is a system that's functionally correct but wrong on an operational property (feature state across a deploy) or blind to a concentrated regression hidden by a label lag.

### References

1. Federal Reserve / OCC, *SR 11-7: Guidance on Model Risk Management*, 2011.
2. Bank of England PRA, *SS1/23: Model Risk Management Principles for Banks*, 2023; ECB, *Guide to internal models (TRIM)*, 2019/2024.
3. CFPB, *Regulation B / ECOA* adverse-action requirements; *Circular 2022-03* (adverse action and complex algorithms).
4. Interagency, *Fair lending / disparate impact* examination guidance.
5. Lundberg & Lee, *A Unified Approach to Interpreting Model Predictions* (SHAP), NeurIPS 2017; Ribeiro et al., *"Why Should I Trust You?"* (LIME), KDD 2016.
6. Jethani et al. / Slack et al., *Fooling LIME and SHAP* and work on explanation (in)stability and (un)faithfulness.
7. Sculley et al., *Hidden Technical Debt in Machine Learning Systems*, NeurIPS 2015.
8. Chip Huyen, *Designing Machine Learning Systems*, 2022 (feature stores, training-serving skew, drift, monitoring).
9. Gama et al., *A Survey on Concept Drift Adaptation*, ACM Computing Surveys 2014; population-stability-index practice in credit risk.
10. Feast, Tecton, AWS SageMaker Feature Store, Databricks Feature Store — documentation (offline/online parity, point-in-time joins).
11. Vintage analysis / vintage curves in consumer credit — standard credit-risk monitoring practice.
12. *System Design Interview Vol. 2*, Alex Xu & Sahn Lam — payment-system chapter (four-step structure).
13. Module 182 (serving), Module 183 (adaptation), Module 184 (evaluation — the eval gate and the online-assurance discipline reused here) — this course.

---

## 13. Low-Level Design

**Requirements.** Author a feature once and serve it consistently offline/online with point-in-time correctness; detect training-serving skew in production; register models with governance metadata and gate promotion; monitor drift and proxies under label lag; keep the inventory complete.

**Class diagram (textual)**

```
FeatureRegistry
 ├─ register(transform, entity, owner, lineage) -> Feature(version)
 ├─ proxyReviewGate(feature) -> APPROVED | REJECTED     # prohibited-attribute proxies
 └─ compile(feature) -> {OfflineMaterializationJob, OnlineUpdatePath}

OfflineFeatureStore
 ├─ asOfJoin(labels, featureVersions, policy) -> TrainingSet(snapshot_sha256)   # Medium exercise (point-in-time)
 └─ recompute(entityId, asOfTs) -> dict[str,float]      # used by the skew detector

OnlineFeatureStore
 ├─ get(entityId) -> {values, coverage_signal, freshness}
 ├─ streamingUpdater (checkpointed state; backfill-on-cold-start)
 └─ p99 <= ~5ms ; hard timeout

ScoringService
 ├─ score(entityId) -> {score, decision}
 ├─ underCovered(feature) -> treat as MISSING (trained handling + conservative fallback)
 └─ log(feature_vector, minutes_since_deploy)

SkewDetector                       # Hard exercise
 ├─ sample(scoringEvents)
 ├─ compare(logged_online, OfflineFeatureStore.recompute) -> per-feature skew_rate (sliced by minutes_since_deploy)
 └─ onHigh(correlated_with_deploy) -> auto-rollback | conservative-hold

ModelRegistry
 ├─ register(artifact, lineage, proposedTier) -> Model(not_validated)
 ├─ attachValidation(report, findings) -> validation_state
 └─ promote(target) -> requires (validated & committee_approval) for production

DeploymentController
 ├─ stage: shadow -> challenger -> canary -> production (rollback always)
 └─ challengerHarness: evaluate_challenger(...)   # Expert exercise

MonitoringService
 ├─ featurePSI(segment-sliced, seasonally-referenced)  # Easy exercise
 ├─ proxyFloors(EPD, vintage curves, approval/override)   # label-lag window
 ├─ fairnessMetrics ; attributionDrift
 └─ triage(finding) -> repeated-occurrence auto-escalates to model owner

ModelInventory
 ├─ reconcile(discovered_endpoints) -> shadow-model findings
 └─ blockNonRegistryDeployPaths()

ExplainabilityService
 └─ reasonCodes(decisionId) -> faithful adverse-action reasons (stable SHAP config)
```

**Sequence diagram** — see §3 and the §12 walkthrough.

**Design patterns used.** Registry (feature registry, model registry, inventory); Strategy (feature transforms, drift tests, challenger-promotion policy); Template Method (training pipeline; validation workflow — fixed pillars, pluggable batteries); Observer (MonitoringService, SkewDetector on production events); Circuit Breaker (feature-fetch timeout → conservative fallback; skew-triggered rollback); Specification (production-promotion gate as an evaluable rule); Memento (immutable data snapshots, model versions).

**SOLID mapping.** *SRP* — feature authoring, offline store, online store, scoring, skew detection, registry, deployment, monitoring, inventory, explainability each isolated. *OCP* — a new drift test, a new proxy indicator, a new validation battery plug in without touching the cores. *LSP* — offline/online stores behind a `FeatureStore` interface for the parts that must agree; challenger and champion behind `Model`. *DIP* — the platform depends on an `EvalGate` abstraction (Module 184) and a `ValidationWorkflow` abstraction, reusing the firm's eval and MRM infrastructure.

**Extensibility.** A GenAI support tool onboards by getting an inventory entry, a tier, a monitoring plan (Module 184's regime), and a validation — reusing the same registry/inventory/governance spine. A new jurisdiction's MRM rules = a validation-battery variant + a revalidation-cadence policy. A new feature source = a registered transform with lineage.

**Concurrency / thread safety.** Feature definitions and data snapshots are immutable/versioned → lock-free reads; content hashes make writes idempotent. The online store is per-entity partitioned with last-write-wins + bounded staleness; the streaming updater checkpoints state atomically. `scoring_event` ingestion is at-least-once, idempotent on an event key. Registry promotions take a per-model lock (one production version at a time). The SkewDetector and MonitoringService are scheduled and single-flighted per model with heartbeats. Discovery reconciliation runs on a schedule against a consistent snapshot of serving infra.

---

## 14. Production Debugging

**Incident.** A credit-decisioning model went live 9 months ago. Its monitoring plan tracked score-distribution PSI, approval rate, and override rate — all within their bands the whole time. At month 9, the risk team's quarterly vintage analysis showed the **most recent three origination cohorts had 60–90-day delinquency at 6 months running ~35% above the cohorts from a year earlier**, concentrated in one channel (a newer broker partnership). No monitoring alert had fired. The model was ranking risk fine; it was **mis-calibrated for the new channel's population**, approving applicants whose true default probability was higher than the model's estimate, and the losses were already booked into three cohorts.

**Root cause.** Three compounding gaps. (1) **The monitoring plan had no early default-outcome proxy with a floor** — it monitored *inputs and decisions* (score PSI, approval rate) but not *early outcomes* (EPD, vintage curves), so a real performance problem was invisible until the manual quarterly vintage analysis. (2) **Score PSI was computed on the aggregate**, and the aggregate was stable because the new broker channel was still a small fraction of volume — a **segment** PSI would have shown a clear distribution shift in that channel months earlier. (3) The model was **validated on a population that didn't include the broker channel** (it launched after the model), and no **event-triggered revalidation** was raised when the new channel went live — a new population is a material change to the model's use, but the process didn't catch it because "we added a broker partnership" didn't feel like "a model change."

**Investigation.**
- Pulled the broker channel's applications and, where mature enough, early-delinquency outcomes; the model's predicted PDs were systematically ~1.4× too low for that channel.
- Segment PSI on the score distribution, recomputed retroactively for the broker channel, crossed 0.25 in month 3 and 0.4 by month 5 — the signal was there, just never computed at the segment level.
- The broker channel's applicants differed on features the model under-weighted for them (thinner files, different income-documentation mix) — a population the training data barely contained.

**Fix.**
1. **Add early-outcome proxies with floors to every credit model's monitoring plan**: EPD (3 and 6 month) and vintage curves at 3/6/9 months, **per acquisition channel and per product segment**, compared to a seasonally-matched and mix-adjusted baseline, with a pre-registered floor that triggers investigation.
2. **Segment-level PSI mandatory** — score and top-feature PSI computed per channel/product/geography, not just aggregate; a segment breach escalates even if the aggregate is fine.
3. **Event-triggered revalidation on population change** — onboarding a new acquisition channel, product, or geography is an explicit trigger requiring a revalidation (at least a targeted one: is the model valid for this new population?), enforced by a checklist gate in the channel-onboarding process, not left to judgement.
4. **Immediate risk action**: a policy overlay tightening the cutoff for the broker channel pending a recalibrated / channel-aware model; the affected cohorts flagged for enhanced collections.
5. **Recalibrate** (and later retrain with broker-channel data) — ranking held, so recalibration addresses the immediate mis-calibration; a retrain with representative data addresses the root cause.
6. **Report** to the model-risk committee and, given materiality, assess regulatory reporting.

**Prevention.**
- **Monitoring inputs and decisions is not monitoring outcomes.** For a label-lagged model you *must* have early-outcome proxies (EPD, vintage curves) with floors, or a real performance problem is invisible for a year.
- **Segment the monitoring.** A concentrated failure in a small-but-growing segment is invisible in the aggregate until it's large — and by then the losses span cohorts (the course-wide "aggregate can't detect a concentrated failure" pattern).
- **A new population is a material change to a model's use.** Onboarding a channel/product/geography must trigger a revalidation — this needs a process gate, because it doesn't feel like "changing the model."
- Same shape as §4 and the rest of this course: the system was functionally fine; it failed on a monitoring-coverage gap (no outcome proxy, no segment slice) and a governance-trigger gap (population change ≠ recognised as a model change).

---

## 15. Architecture Decision

**Decision.** For a new credit-line-assignment model, which modelling and explainability approach: (A) an unconstrained GBM with SHAP for adverse-action, (B) a monotonically-constrained GBM with SHAP, (C) an interpretable scorecard (constrained logistic / WoE), (D) a GBM for ranking + a scorecard as the decision model?

**Option A — Unconstrained GBM + SHAP.**
*Advantages:* highest raw predictive power; SHAP gives per-decision attributions.
*Disadvantages:* SHAP explanations can be **unstable** near boundaries and in interaction-heavy regions (§A9) — a Reg B risk (reasons must be accurate and specific); the model can learn non-monotonic, hard-to-justify relationships (e.g. risk *decreasing* then increasing with income) that fail conceptual-soundness review; disparate-impact harder to reason about; validation is heavier and slower.
*Cost:* modelling cheap, **validation and adverse-action-defensibility expensive**. *Risk:* high on explainability/regulatory, lower on pure performance.

**Option B — Monotonically-constrained GBM + SHAP.**
*Advantages:* near the unconstrained GBM's performance for most credit problems; monotonic constraints make feature effects directionally sensible (more utilisation → more risk, never less), which makes SHAP **more stable** and the model far easier to justify in conceptual-soundness review and to explain to applicants; disparate-impact reasoning is more tractable.
*Disadvantages:* slightly lower ceiling than unconstrained; you must specify the monotonic direction per feature (a modelling+domain task); still a tree ensemble, so not *fully* transparent.
*Cost:* modest extra modelling effort, **much cheaper validation and adverse-action**. *Risk:* low-medium.

**Option C — Interpretable scorecard.**
*Advantages:* fully transparent — the "model equation" is a points table; adverse-action reasons fall out directly and stably; trivial to validate for conceptual soundness and disparate impact; regulators and internal validators are deeply familiar with it; decades of precedent.
*Disadvantages:* lower predictive power than a GBM on complex feature interactions; more manual feature engineering (binning, WoE); may leave measurable Gini on the table.
*Cost:* more feature-engineering effort, **minimal validation friction**. *Risk:* low; the trade is performance.

**Option D — GBM for ranking + scorecard as the decision model.**
*Advantages:* use the GBM where its power helps (e.g. a challenger, a fraud overlay, prioritising manual review) while the **regulated credit decision** is made by the transparent scorecard — so the decision surface is fully explainable and validatable, and the GBM's strength isn't wasted.
*Disadvantages:* two models to build, validate, and monitor; the operating model must be crystal clear about which model *decides*; risk of scope creep letting the GBM influence the decision informally.
*Cost:* highest build/governance. *Risk:* low on the decision, medium on operational discipline.

**Recommendation — Option B (monotonically-constrained GBM + SHAP) as the default; Option C if the validation function or regulator relationship strongly favours full transparency, or if B's performance edge over C proves marginal on this problem.**
For a regulated credit decision, the binding constraints are adverse-action defensibility, conceptual soundness, and disparate-impact tractability — not the last point of Gini. A monotonically-constrained GBM keeps most of the predictive power while making the model directionally sensible, the SHAP explanations stable, and the validation dramatically lighter. Option A's instability is a real Reg B and validation liability that usually isn't worth the small performance gain. Option C is the safe choice and the right one when transparency is paramount or B's edge is small — and it should be built as the challenger regardless, so the performance trade is *measured*, not assumed. Option D is for cases where a GBM genuinely adds decision-relevant signal that can't be captured in a constrained form — rarer than teams claim.

---

## 17. Principal Engineer Perspective

**Business impact.** In a bank, models drive credit, fraud, AML, and pricing decisions worth billions, under regulators who can — and do — cap or halt a model's use. The Principal's job is to make the ML platform and the model-risk governance fit together so the firm ships good models *fast* and *defensibly*, rather than choosing between speed and a clean exam. A single material model failure or a fair-lending finding doesn't just cost remediation — it can freeze all model deployment until the regulator is satisfied.

**Engineering trade-offs.** The recurring trade is predictive power vs explainability/validatability (§15) — for a regulated decision the binding constraint is usually defensibility, not the last point of Gini, and a Principal makes that call explicitly and measures the trade with a challenger. Other trades: feature freshness vs cost, online consistency vs latency, monitoring coverage vs compute, validation depth vs speed (via tiering).

**Technical leadership.** The recurring failure shape is a model that is *functionally* correct but wrong on an *operational* property no functional test covers — training-serving skew from cold feature state through a deploy (§4), a performance problem invisible for a year because monitoring watched inputs not early outcomes and aggregates not segments (§14). A Principal institutionalises the counters: log every production feature vector and reconcile it against the offline pipeline; monitor early-outcome proxies with floors, segment-sliced and seasonally-referenced; treat a new population as a model change; and give windowed features a coverage signal so a plausible-but-wrong value becomes a handled missing value.

**Cross-team communication.** Model risk is co-owned across three lines of defence, and the second line has authority to block. The Principal's job is to make "effective challenge" *effective* — validators engaged at design so challenge shapes the model, reusable batteries and platform-level validation so it's not a months-long bottleneck, and a shared language (materiality tiers, the SR 11-7 pillars, model inventory) so engineering and risk aren't talking past each other. And to keep the inventory complete — a shadow model is a shared failure, caught by automated discovery, not by an exam.

**Architecture governance.** Standing governed artefacts: the single feature-definition rule and its point-in-time-correctness validation, the prohibited-attribute/proxy review, the model-registry governance schema, the materiality-tiering criteria, the monitoring-plan template (with mandatory early-outcome proxies and segment slicing for label-lagged models), the revalidation-trigger list (including population change), and the model inventory with discovery reconciliation. Reviewed by the platform team and the model-risk committee jointly.

**Cost optimisation.** The feature store's shared definitions and platform-level validation avoid every model re-solving point-in-time correctness. Materiality tiering focuses scarce validator time where it matters. Reusable validation components and monitoring templates cut per-model governance cost. Feature freshness and monitoring cadence are tuned to how fast each signal actually moves. Champion/challenger runs on a sample unless a rare-event metric needs the full population.

**Risk analysis.** The dominant risks: training-serving skew (closed by one definition + feature-vector logging + a standing skew detector through deploys); performance invisible under label lag (closed by early-outcome proxies with floors, segment-sliced); a concentrated failure hidden by aggregates (closed by mandatory segmentation); a protected-attribute proxy in a model (closed by feature-onboarding review + disparate-impact gates); a shadow / unvalidated model in production (closed by a complete inventory + discovery reconciliation + blocked non-registry deploy paths); a new population invalidating a model (closed by population-change as a revalidation trigger); unfaithful/unstable explanations (closed by constrained models + stable SHAP config, or a scorecard). Every one has regulatory teeth, not just an SLA.

**Long-term maintainability.** The platform *and* the governance decay independently — feature definitions fork under deadline pressure, monitoring references go stale, the validation backlog grows, the inventory drifts from reality, thresholds accrete slack. It stays healthy only if the meta-signals are trended (skew-detector findings, inventory-completeness gap, validation backlog and overdue revalidations, findings aging and recurrence, monitor coverage and alert-triage health) and reviewed with the model-risk committee on a cadence — the same "verify the verifier, detect by trend and by segment, treat absence as a finding" discipline this course has applied at every layer, here applied to a discipline that a regulator will also independently verify.

---

## Domain close — `44-AI-Systems` (Modules 162–185)

This module closes the merged `44-AI-Systems` domain. The arc: Modules **162–168** built the LLM application layer (fundamentals, prompt engineering, RAG, integration, agents, MCP, a governed capstone); Module **181** covered AI-assisted software engineering (Claude Code, GitHub Copilot, agentic-coding governance); and the **182–185** gap-fill covered the infrastructure and lifecycle beneath the application layer — **serving** (182: batching, KV cache, quantization, parallelism, the model gateway), **adaptation** (183: fine-tuning, LoRA/PEFT, distillation, the prompt-vs-RAG-vs-tune decision), **evaluation** (184: golden sets, LLM-as-judge, statistical rigour, CI gates, online experiments), and **ML lifecycle & model risk** (185: feature stores, drift monitoring, champion/challenger, SR 11-7 independent validation).

One finding recurs across all fourteen modules and is the domain's throughline: **AI-systems risk lives in the gap between a technology's genuine capability and the governance discipline actually built to match it — concentrated at the seams between independently-built components, and closable only by continuous verification, never a one-time fix.** Every module is a specific instance: a serving platform "autoscaled" but slower to scale than its burst; a fine-tune with a true accuracy number about the wrong population; an eval gate green because its instrument was biased toward the change; a credit model whose real performance was structurally unknowable for a year. In each, the technology worked; the gap was between what was *declared* and what was *verified* — and the Principal's job, across the whole domain, is to close that gap with independent verification, sliced metrics with floors, detection by trend and by absence, and the discipline to act on a proxy before the ground truth arrives.

---

**End of the `44-AI-Systems` domain.**
