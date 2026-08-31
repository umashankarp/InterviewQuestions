# Module 183 — Model Adaptation: Fine-Tuning, LoRA/PEFT, Preference Tuning, Distillation & the Prompt-vs-RAG-vs-Tune Decision

> Domain: AI Systems (merged 44-50) | Level: Beginner → Expert | Prerequisite: [[../44-AI-Systems/01-AI-Systems-LLM-Fundamentals-Transformers-Tokenization-Inference]], [[../44-AI-Systems/02-Prompt-Engineering-Techniques-StructuredOutput-Testing-InjectionDefense]], [[../44-AI-Systems/03-RAG-Retrieval-Augmented-Generation-ChunkingStrategies-HybridSearch-Evaluation]], [[../44-AI-Systems/09-LLM-Inference-Serving-Infrastructure-Batching-KVCache-Quantization-Parallelism]]

>
> **Scope note:** Tenth module of the merged `44-AI-Systems` domain, second of the 182–185 gap-fill. Modules 162–168 mostly assumed a hosted, un-modified model; Module 182 §15 recommended a *task-specific fine-tune* as the workhorse for a high-volume workload and left the question of how you actually produce and maintain that model. This module answers it: what fine-tuning changes (and, crucially, what it does *not* — injecting facts is RAG's job, not fine-tuning's), the PEFT/LoRA mechanics that make it affordable, distillation, preference tuning, and the decision framework for choosing prompt engineering vs RAG vs fine-tuning vs continued pretraining. The throughline: **an adapted model's quality is a property of the data it was adapted on and the evaluation that gated it — both of which decay independently of the model artefact.** §12 follows the four-step System Design spine.

---

## 1. Fundamentals

**What.** *Model adaptation* is changing a model's behaviour for your use case. There are four levers, in ascending order of cost, lead time, and maintenance burden:

| Lever | What it changes | Solves | Typical cost / lead time |
|---|---|---|---|
| **Prompt / context engineering** | Nothing in the model; the input | Format, tone, task framing, few-shot behaviour | Hours; ~free |
| **RAG** (Module 164) | Nothing in the model; adds retrieved knowledge to the context | **Knowledge** — facts, documents, up-to-date or proprietary information | Days–weeks; retrieval infra |
| **Fine-tuning** (SFT / PEFT / preference tuning) | The model weights (or a small adapter) | **Behaviour** — consistent format/style, domain phrasing, task specialisation, following implicit conventions, and using a *smaller/cheaper* model to match a bigger one on a narrow task | Weeks; training + data-curation + eval infra |
| **Continued pretraining** / domain-adaptive pretraining | The model weights, broadly | **Capability** — a genuinely different domain distribution (rare language, heavy jargon, unusual code/DSL) the base model underperforms on | Months; large data + serious compute |

**Why the ordering matters for a Principal.** The default failure is reaching for fine-tuning to solve a problem the cheaper levers solve better. The single most common one: *"the model doesn't know our products / policies / latest rates, so let's fine-tune it on our docs."* Fine-tuning on documents is a poor way to inject knowledge — the model learns the *style* of the docs, memorises some facts unreliably, hallucinates confidently on the rest, and goes stale the moment a document changes. **RAG is the knowledge lever; fine-tuning is the behaviour lever.** Fine-tuning earns its cost when you need: rock-solid output format at scale, a specific domain voice, a narrow task done by a small cheap model instead of a big expensive one (Module 182 §15), lower latency, or behaviour that's genuinely hard to specify in a prompt but easy to demonstrate with examples.

**When fine-tuning is the right call.**
- **Format/schema reliability**: you need valid structured output ~100% of the time and prompt+constrained-decoding still isn't enough at your volume.
- **Cost/latency**: a fine-tuned 8B matches a prompted 70B on your narrow task at ~5–10× lower tokens/$ and half the latency (Module 182 §15's recommendation).
- **Implicit conventions**: house style, tone, domain shorthand, "how we phrase a suitability rationale" — easy to show, hard to write rules for.
- **Task specialisation**: classification, extraction, routing, summarisation in a fixed house format — where you have thousands of good labelled examples.
- **Behaviour you can't prompt away**: the base model over-refuses, or won't stop adding disclaimers, or won't follow a subtle ordering rule.

**When it is not.**
- The need is *knowledge that changes* → RAG.
- You have < a few hundred good examples → prompt engineering / few-shot.
- The base model already does it well with a better prompt → do that.
- You'd have to retrain every time a policy document changes → RAG.

**How (30,000-ft).**
```
Is the gap KNOWLEDGE (facts/docs, changing)?           → RAG (Module 164). Stop.
Is it FORMAT/TONE/TASK the base model can nearly do?    → prompt + few-shot + constrained output (163). Stop.
Still short, and you have 1k+ good examples?            → SFT, usually via LoRA/QLoRA.
Need a smaller/cheaper model to match a bigger one?     → distil: big model generates data → SFT the small one.
Base model behaviour is misaligned (over-refuses etc)?  → preference tuning (DPO), on top of SFT.
Whole domain distribution is alien (rare lang, DSL)?    → continued pretraining. Rare; expensive.
Always: gate on an eval that measures the target gain AND regression on general capability,
        on a held-out set that reflects the REAL production distribution.
```

---

## 2. Deep Dive

### 2.1 What fine-tuning actually changes — and catastrophic forgetting

SFT continues gradient descent on next-token prediction over your `(prompt, ideal_completion)` pairs. The model's weights shift toward producing your completions. Consequences:

- It learns **surface behaviour** — your format, your phrasing, your task mapping — quickly and reliably from as few as hundreds to low-thousands of examples.
- It learns **facts** slowly, unreliably, and without a confidence signal — a fact seen 3× in training may or may not surface, and the model will confabulate the rest in your house style, which makes the hallucination *harder* to spot. This is why FT is not the knowledge lever.
- **Catastrophic forgetting**: shifting weights toward your narrow distribution degrades capabilities not represented in your data — general reasoning, instruction-following, refusal behaviour, other output formats, other languages. A model fine-tuned hard on "classify this filing into one of 8 buckets" can get *worse* at explaining its reasoning, at handling an out-of-distribution input gracefully, or at emitting the JSON wrapper you also depend on. PEFT (§2.2) reduces but does not eliminate this; the defence is an eval that checks **regression on general capability**, not just the target-task gain (§2.7).

### 2.2 LoRA / QLoRA / PEFT — how fine-tuning became affordable

**Full fine-tuning** updates all P parameters: you need optimiser state (~2× the params for Adam) plus gradients plus activations in GPU memory — roughly 12–16 bytes/param, so a 7B model needs ~100+ GB, a 70B needs a multi-node cluster. Prohibitive for most teams.

**LoRA (Low-Rank Adaptation)**: freeze the base weights. For selected weight matrices W (d×k), learn a low-rank update ΔW = B·A where A is r×k and B is d×r, with **rank r ≪ d,k** (typically 8–64). At inference, output = W·x + (α/r)·B·A·x. You train only the A and B matrices — often **< 1%** of the parameter count.

- **Memory**: no optimiser state for the frozen base; only the tiny adapters have gradients/optimiser state. A 7B LoRA fine-tune fits on a single high-end GPU.
- **QLoRA**: additionally load the *frozen base* in 4-bit (NF4) quantization, dequantising per-layer during the forward/backward pass. This drops base-model memory ~4×, so a **70B QLoRA fine-tune fits on a single 80 GB GPU**. The adapters are still trained in higher precision. Small quality cost vs full-precision LoRA, usually acceptable.
- **Key hyperparameters**: `r` (capacity of the update — higher = more expressive, more params, more forgetting risk), `alpha` (scaling; often set to `r` or `2r`), **which modules** to adapt (attention projections `q,k,v,o` is the common baseline; adding the MLP projections helps for harder adaptations at more cost), `dropout`.
- **Adapter merging**: `W' = W + (α/r)·B·A` can be folded into the base weights for a standalone model with zero inference overhead — or kept separate for multi-adapter serving.
- **Multi-adapter serving** (Module 182 §9): one base model in GPU memory, many small LoRA adapters, the right adapter selected per request (e.g. one adapter per tenant or per task). Serving frameworks (S-LoRA, vLLM's multi-LoRA) batch requests across different adapters. This is how you offer "a fine-tune per team" without N copies of a 70B model.

**When full FT still wins**: very large behaviour shifts, continued pretraining, or when you've measured LoRA leaving quality on the table for your task. For most enterprise task-specialisation, LoRA/QLoRA is the default and full FT is the exception.

### 2.3 Supervised fine-tuning (SFT) — the data *is* the model

The dominant, under-appreciated fact: **SFT quality is bottlenecked by data quality, not by hyperparameters or model choice.** Practitioners iterate on the dataset 10× more than on the training config. What matters:

- **Correctness**: every completion is one you would ship. A few hundred pristine examples beat tens of thousands of mediocre ones. Bad examples teach bad behaviour directly.
- **Format consistency**: identical structure across every example — same system prompt, same delimiters, same output schema. Inconsistency teaches the model that format is optional.
- **Coverage & balance**: the example distribution *is* what the model optimises toward (Module 163 §4 — few-shot bias, now permanent). If your training set is 70% "general inquiry" and 3% "suspected fraud," the model will be biased against predicting "suspected fraud," and your **validation set drawn from the same pool will hide it** (§4). Deliberately balance, or at least measure and correct for, class distribution — and oversample the rare-but-critical cases.
- **Volume**: task specialisation often needs only 1k–10k good examples; format/tone can need fewer. More is not better if it's noisier.
- **Train/val/test hygiene**: split so there's no leakage — no near-duplicate spanning the split, and for time-series-flavoured data (filings, tickets, transactions) split **by time** (train on older, test on newer) so you measure generalisation to the *future*, not interpolation (Module 184; §11 exercise).
- **Overfitting signs**: val loss rising while train loss falls; the model reproducing training examples verbatim; brittle on slight input variations. LoRA with a modest `r`, 1–3 epochs, and early stopping on a real held-out set are the usual guards.

### 2.4 Preference tuning — RLHF, DPO, and when you'd bother

SFT teaches "produce this output." **Preference tuning** teaches "prefer output A over output B," which shapes harder-to-demonstrate qualities (helpfulness, harmlessness, house judgement calls, not-over-refusing).

- **RLHF**: train a **reward model** on human preference pairs, then optimise the policy against it with PPO (with a KL penalty to stay near the SFT model). Powerful, complex, unstable, compute-heavy — this is how frontier labs align base models.
- **DPO (Direct Preference Optimisation)**: skips the separate reward model and RL loop — a single classification-style loss directly on preference pairs `(prompt, chosen, rejected)`. Far simpler and more stable; the common choice when an enterprise does preference tuning at all.
- **ORPO / KTO / SimPO**: further simplifications (ORPO folds preference into SFT in one stage; KTO needs only thumbs-up/down, not pairs).

**Enterprise reality**: most teams never do preference tuning. You reach for it when SFT + prompting leaves a *behavioural* gap — the model over-refuses legitimate queries, won't drop boilerplate, or makes the wrong call on ambiguous cases your business has a defined stance on — and you have preference data (often from human review logs: "reviewer picked this rewrite over that one"). Do SFT first; DPO on top; measure that it didn't regress task accuracy or safety.

### 2.5 Distillation — a small model that acts like a big one

**Knowledge distillation**: transfer capability from a large **teacher** to a small **student**.

- **Response-based (sequence-level) distillation** — the practical enterprise form: the teacher (a big model, prompted well) generates high-quality completions for your inputs; you SFT the student on those `(input, teacher_output)` pairs. The student learns to imitate the teacher on *your distribution*. This is exactly Module 182 §15's "8B fine-tune as the workhorse" — the 70B is the teacher.
- **Logit/feature-based distillation**: train the student to match the teacher's output *distribution* (soft labels) or internal representations. Needs teacher logits, so it requires an open teacher or one that exposes logits; higher fidelity, more setup.
- **Synthetic data generation**: the teacher also generates *diverse inputs*, not just outputs — useful when you're short on real examples, with the caveat that synthetic data can be narrow or subtly wrong; mix with and validate against real data.
- **The terms-of-service caveat**: many hosted model providers' terms **prohibit using their outputs to train a competing model**. Distilling a hosted commercial model into your own can be a contract violation. Check the terms; open-weight teachers or your own licensed model avoid the issue.
- **Eval parity check**: the point of distillation is cost/latency at *acceptable* quality — always measure the student against the teacher on the target eval set and decide the trade explicitly (Module 182 §A3).

### 2.6 Continued pretraining / domain-adaptive pretraining

When the *domain distribution itself* is far from the base model's — dense legal/medical/regulatory language, a proprietary DSL, a low-resource language, a large private code corpus — continued pretraining (more next-token prediction on a large unlabelled domain corpus, before any SFT) can lift the base capability. Requirements: a large corpus (billions of tokens), serious compute, and careful mixing with general data to limit catastrophic forgetting of broad ability. It's rare in enterprise because the bar is high and RAG + SFT usually suffices; consider it only when you've measured the base model genuinely failing to *understand* the domain, not just failing to *format* or *recall* — and budget for it like a project, not a task.

### 2.7 Evaluating an adapted model

An adaptation is a model change and gets the full eval gate (Module 184). Minimum:

1. **Target-task gain** on a held-out set that reflects the **real production distribution** — not a random split of the (possibly skewed) training pool. Slice by the categories/segments that matter, especially the rare-but-critical ones.
2. **Regression on general capability** — instruction-following, reasoning, other output formats you also depend on, refusal/safety behaviour, other languages. Catastrophic forgetting is silent otherwise.
3. **Format adherence** — schema-valid output rate, especially if downstream parsing assumes it.
4. **Comparison to the alternatives you skipped** — is the fine-tune actually beating a better-prompted base model, or RAG? If not, ship the cheaper thing.
5. **Contamination check** — none of the eval set leaked into training (near-duplicates, same source documents).
6. **Pinned artefacts** — the base model version, the adapter, the training data snapshot, and the eval result are recorded together as the release evidence, because all four must line up (§14).

---

## 3. Visual Architecture

**The adaptation decision tree**

```
                         ┌─────────────────────────────┐
                         │  What is the gap?           │
                         └──────────────┬──────────────┘
              knowledge (facts/docs,    │      behaviour (format/tone/task/
              changes over time)        │      cost/latency), hard to prompt
                         ▼              │              ▼
                   ┌──────────┐         │      ┌────────────────────┐
                   │   RAG    │         │      │ have 1k+ good       │──no──► better prompt
                   │ (Mod 164)│         │      │ examples?           │        + few-shot (163)
                   └──────────┘         │      └─────────┬──────────┘
                                        │            yes ▼
              whole domain distribution │      ┌────────────────────┐
              alien (rare lang / DSL)   │      │ SFT via LoRA/QLoRA  │
                         ▼              │      └─────────┬──────────┘
                ┌──────────────────┐    │       need small model to
                │ continued        │    │       match a big one?
                │ pretraining      │    │            ▼
                └──────────────────┘    │      ┌────────────────────┐
                                        │      │ distil: teacher    │
              behaviour still misaligned│      │ generates data →   │
              (over-refuses, judgement) │      │ SFT the student    │
                         ▼              │      └────────────────────┘
                ┌──────────────────┐    │
                │ DPO on top of SFT│    │
                └──────────────────┘    │
                                        ▼
                        ┌──────────────────────────────────┐
                        │ EVAL GATE (Module 184):          │
                        │  target gain (real distribution) │
                        │  + general-capability regression │
                        │  + format + contamination        │
                        │  vs the cheaper alternative       │
                        └──────────────────────────────────┘
```

**LoRA adapter (one attention projection)**

```
        x ──────────────┬───────────────► W (frozen, d×k) ──► + ──► h
                        │                                     ▲
                        └──► A (r×k, trained) ──► B (d×r) ──► ×(α/r)
                              rank r ≪ d,k   (< 1% of params trained)

  merge for standalone:  W' = W + (α/r)·B·A       (zero inference overhead)
  keep separate:         many adapters, one base  (multi-LoRA serving)
```

**Training & release pipeline**

```
raw sources → dataset curation → validation (format, dedup, leakage, balance) → versioned snapshot
                                                                                      │
                                          base model (pinned version) ──► LoRA/QLoRA SFT ──► [DPO?]
                                                                                      │
                                                                              adapter artefact
                                                                                      │
                                             EVAL GATE (real-distribution held-out + regression)
                                                                    │ PASS
                                                          model registry (base+adapter+data+eval, pinned)
                                                                    │
                                                          serving (Module 182: multi-LoRA pool, canary rollout)
                                                                    │
                                              drift monitor ──► retrain trigger ──► (loop)
```

---

## 4. Production Example

**Context.** A bank builds an automated first-pass classifier for inbound regulatory correspondence — routing each item to one of 9 handling queues (routine acknowledgement, information request, examination notice, enforcement referral, …). Volume is high; a prompted 70B works but is expensive and slower than the SLA wants. Following Module 182 §15, the team fine-tunes an 8B model (LoRA) as the workhorse. Training data: **five years of historical items with the queue an analyst actually assigned**, ~140k labelled examples. Standard random 80/10/10 split. The fine-tune hits **96.4% validation accuracy**, comfortably beating the prompted-8B baseline and within a point of the 70B. Signed off, shipped.

**The incident.** Four months later, a compliance audit finds that **17 "examination notice" items over the quarter had been routed to "routine acknowledgement"** and sat unactioned past the regulatory response deadline — a reportable control failure. The model's overall accuracy in production was still ~95%. The failure was concentrated entirely in the two rarest, highest-consequence classes.

**Investigation.**
- Class distribution of the training data: "routine acknowledgement" 61%, "information request" 22%, … "examination notice" **1.4%**, "enforcement referral" **0.6%**. Five years of correspondence is dominated by routine traffic.
- The random 80/10/10 split gave the **validation set the same skew** — only ~200 "examination notice" examples in validation, and the 96.4% aggregate was carried by the model nailing the two majority classes. Per-class recall on "examination notice" was **71%**; on "enforcement referral", **58%**. Nobody had looked at per-class recall — the sign-off metric was one aggregate number.
- Worse: over the five years, the *definition* of what counts as an "examination notice" had shifted (a 2023 regulatory change), so the older training examples — the bulk — were labelled under an older rubric. The model had learned a stale decision boundary for the class that mattered most.
- Root cause, in the domain's recurring form: **the validation set was drawn from the same skewed, time-mixed pool as the training set, so it certified the model against a distribution that was neither balanced nor current — the reported 96.4% was a true number about the wrong population.** Declared accuracy ≠ accuracy on the production distribution where the rare, consequential classes live.

**Fix.**
1. **Held-out-by-time eval set**, hand-audited against the *current* rubric, deliberately **over-sampled on the rare classes** (enough "examination notice" / "enforcement referral" items for a statistically meaningful per-class recall — pulled from a longer history and re-labelled to the current standard). This becomes the release gate.
2. **Per-class precision/recall as the sign-off metric**, with a hard floor on the two consequential classes and no aggregate-only approval.
3. **Class rebalancing in training**: oversample the rare classes and/or use class-weighted loss; add synthetic-but-reviewed examples generated by the 70B for the thin classes (distillation-style, §2.5), each checked by an analyst.
4. **Recency weighting / filtering**: drop or down-weight pre-2023 examples for the redefined class; retrain.
5. **Fail-safe routing**: any prediction for a majority class with **low margin** over a consequential class is routed to human triage rather than auto-actioned — the cost of a false "routine" on an "examination notice" is asymmetric, so the decision threshold is asymmetric.
6. **Drift monitor**: track the production class distribution and per-class agreement with later human corrections; alert on movement.

**Lessons.**
- **An aggregate accuracy number is blind to a concentrated failure in a rare class** — the same "an aggregate cannot detect a concentrated failure" pattern this course has hit in monitoring (Modules 132/133/176) and hot-shard latency (Module 177), here in model evaluation. Sign off on *sliced* metrics with floors on the classes that carry the consequence.
- **A random split of a skewed pool produces a validation set that hides the skew.** The eval set must be constructed to reflect the *production* distribution and to have enough of the rare-critical cases to measure them — usually by hand, usually over-sampled, usually re-labelled to the current standard.
- **Training data has provenance and a shelf life.** "Five years of analyst labels" is not one clean dataset — it's five vintages, some under an obsolete rubric. Module 163 §4's "convenient recent sample" skew, recurring as "convenient historical corpus" skew.
- **Asymmetric consequences demand asymmetric thresholds** — a model that's 95% accurate but wrong in the expensive direction is not fit for auto-action on that path.

---

## 5. Best Practices

- **Exhaust the cheaper levers first.** Prompt + few-shot + constrained output; then RAG if the gap is knowledge. Fine-tune only when a measured behavioural/cost/latency gap remains.
- **RAG for knowledge, fine-tuning for behaviour.** Don't fine-tune on documents to teach facts.
- **Default to LoRA/QLoRA.** Full fine-tuning is the exception (very large behaviour shifts, continued pretraining).
- **Spend your time on data, not hyperparameters.** Curate ruthlessly: correctness, format consistency, coverage, class balance, dedup, no train/test leakage.
- **Build the eval set to reflect production**, over-sample the rare-critical cases, split by time for time-flavoured data, and hand-audit it. Sign off on **sliced** metrics with floors, never one aggregate.
- **Always test general-capability regression**, not just the target gain — catastrophic forgetting is silent.
- **Pin the tuple**: base model version + adapter + training-data snapshot + eval result, recorded together (§14).
- **Prefer multi-LoRA serving** (one base, many adapters) over N full model copies when you need per-team/per-task variants.
- **Check provider terms before distilling a hosted model.** Use open-weight or your own licensed teacher.
- **Plan the retrain loop**: a drift monitor and a defined trigger/cadence, because the world the model was tuned on moves.
- **Prefer managed fine-tuning** (a provider's or cloud's FT API) unless data residency, a custom recipe, or scale forces you to run your own training infra.

---

## 6. Anti-patterns

- **Fine-tuning to inject knowledge** — learns style, memorises unreliably, hallucinates in your house voice, goes stale on the next doc update. Use RAG.
- **Random split of a skewed dataset** — the val set inherits the skew and certifies the model against the wrong distribution (§4).
- **Aggregate-only sign-off** — blind to a concentrated failure in a rare, consequential class.
- **Iterating on learning rate and epochs while the dataset is dirty** — the data is the bottleneck; polishing hyperparameters on noisy labels is wasted effort.
- **No general-capability regression check** — the model gets better at the target and worse at the JSON wrapper / the refusal / other languages, discovered in production.
- **Training against an unpinned base model** — a provider base-model update + your old adapter = silent degradation (§14).
- **Treating "five years of logs" as one clean dataset** — multiple label vintages, obsolete rubrics, drift baked in.
- **Distilling a hosted commercial model in violation of its terms** — a contract and IP risk, not just a technical choice.
- **Over-fitting `r`** — a large LoRA rank on a small dataset memorises and forgets more; start small.
- **Full fine-tuning by reflex** — expensive, more forgetting, harder to serve as variants, rarely necessary for task specialisation.
- **No retrain plan** — ship once, never revisit; quality drifts as the input distribution moves.

---

## 7. Performance Engineering

- **Training cost**: LoRA/QLoRA on a 7–8B model is single-GPU, hours to a day for a task fine-tune of a few thousand examples. Full FT of the same is multi-GPU and ~10× the cost. 70B QLoRA fits one 80 GB GPU but is slow; 70B full FT is a cluster job. Budget the *iteration* cost — you will train 10–30 times while curating data.
- **Data pipeline**: tokenisation, dedup (min-hash / embedding near-dup), leakage checks, and balance reports over 100k+ examples should be a repeatable batch job, not a notebook. Dataset prep time usually dominates training time.
- **The iterate-on-data loop**: the fast loop is *change the dataset, retrain LoRA, re-run the eval set* — keep it under an hour end-to-end so you can do many passes. A slow eval harness kills iteration speed; sample it for the inner loop, run the full gate for release.
- **Serving impact (ties to Module 182)**: a merged fine-tune has zero inference overhead. Multi-LoRA serving adds a small per-request adapter-selection and a modest batching-efficiency cost when a batch spans many adapters; a merged single-adapter pool is fastest if you only have one variant.
- **Distillation economics**: generating 50k teacher completions from a 70B is a real inference bill (one-time) — batch it, use the cheapest acceptable teacher, and reuse the dataset across student iterations.
- **Benchmark the end state**: fine-tuned-small vs prompted-large on *tokens/$/latency at the target eval score* — that comparison is the whole justification for the project (Module 182 §15).

---

## 8. Security

| Threat | Vector | Mitigation |
|---|---|---|
| **Training-data memorisation & extraction** | PII/PANs/client data in the training set can be regurgitated verbatim by the model or extracted via crafted prompts | Scrub/pseudonymise training data (DLP pass, Module 181); minimise sensitive fields; test the model for memorisation (prompt it with prefixes of training records); prefer RAG (retrieved, access-controlled) over baking data into weights |
| **Right-to-be-forgotten / data deletion** | A subject requests deletion; their data is baked into model weights and cannot be surgically removed | Don't put deletable personal data in training sets — keep it in the RAG store where it can be deleted; if unavoidable, plan for retrain-from-clean-snapshot as the deletion mechanism and document the lag |
| **Data poisoning** | A malicious or careless contributor injects examples that teach a backdoor or a bias (e.g. "always route items mentioning 'ProjectX' to low-priority") | Provenance and review on every training example; anomaly detection on the dataset; hold-out canary checks for known-bad behaviours; restrict who can contribute training data |
| **Adapter / weight IP theft** | A fine-tune encodes proprietary process knowledge and data-derived signal; the adapter file is small and easy to exfiltrate | Treat adapters as crown-jewel artefacts (Module 182 §A6) — encrypted, access-controlled registry, egress-locked training/serving subnets, signed and hash-pinned, audit every pull |
| **Distillation of your model by others** | An API consumer harvests your fine-tuned model's outputs to clone it | Rate limits, query-pattern anomaly detection, contractual terms; watermarking where feasible |
| **ToS violation by distilling a vendor model** | Using a hosted commercial model's outputs to train a competitor | Legal review of provider terms before any distillation; use open-weight or owned teachers |
| **Eval-set leakage inflating confidence** | Eval examples present in training make the model look safe when it isn't | Contamination check (near-dup + source-document overlap) as a hard gate; keep the eval set access-controlled and versioned separately |

The framing: **fine-tuning moves data from a deletable, access-controlled store (RAG) into the weights, where it is neither** — so the security default is *keep sensitive and deletable data out of training* and use adaptation for behaviour, not for data.

---

## 9. Scalability

- **Many variants**: one base model + N LoRA adapters (per tenant, per task, per region) served from a multi-LoRA pool (Module 182 §9) — scales to dozens of variants without N model copies. Beyond a point, adapter-diverse batches lose efficiency; group high-volume adapters into their own merged pools.
- **Training throughput**: for a handful of fine-tunes, a small shared GPU pool or a managed FT API suffices. If dozens of teams each want frequent fine-tunes, you need a training *platform* — job queue, dataset registry, quota, eval-gate automation, artefact registry — which is a build decision (§12).
- **Dataset scale**: curation, dedup, and balance reporting over millions of examples need distributed data processing (Spark/Ray) and a versioned dataset store; this is often the real scaling bottleneck, not GPU time.
- **Retraining cadence at scale**: a drift-triggered or scheduled retrain per fine-tune, each running the full eval gate and a canary rollout — orchestrated, not manual, once you have more than a few models.
- **Eval at scale**: the eval gate itself (Module 184) becomes a shared service — as more models onboard, its throughput and dataset-management need to scale with them.
- **Cost governance**: training and teacher-distillation spend needs the same per-team metering and chargeback as inference (Module 182 §E2), or fine-tune requests grow unbounded.
- **CAP/consistency**: the model+adapter+data+eval registry is CP — deploying a mismatched or unvalidated tuple is worse than a slow deploy. Training jobs are batch/async and tolerate delay.

---

## 10. Interview Questions

### Basic (10)

**B1. Q: What is the difference between what RAG solves and what fine-tuning solves?**
*Ideal answer:* RAG adds *knowledge* to the model's context at query time — facts, documents, proprietary or changing information — without touching the weights, so it stays current and the sources are auditable. Fine-tuning changes the weights (or a small adapter) to change *behaviour* — output format, tone, domain phrasing, task specialisation, or letting a smaller cheaper model match a bigger one on a narrow task. Fine-tuning on documents is a poor way to inject knowledge: the model learns their style, memorises facts unreliably, and goes stale on the next update.
*Why correct:* Knowledge vs behaviour, weights-untouched vs weights-changed, and the "don't fine-tune for facts" consequence.
*Common mistakes:* "Fine-tune so it knows our data"; thinking they're interchangeable.
*Follow-up:* "A team wants the model to know the latest interest rates — which lever?" / "When would you use both together?"

**B2. Q: What is LoRA and why did it make fine-tuning practical?**
*Ideal answer:* LoRA freezes the base model and learns a small low-rank update (two matrices A and B, rank r ≪ dimension) added to selected weight matrices — typically under 1% of the parameters are trained. Because the base is frozen, there's no optimiser state for it, so memory drops enormously: a 7B LoRA fine-tune fits on one GPU where full fine-tuning needs 100+ GB. QLoRA additionally loads the frozen base in 4-bit, fitting a 70B fine-tune on a single 80 GB GPU.
*Why correct:* Frozen base + low-rank trainable adapter + the memory consequence, plus QLoRA.
*Common mistakes:* Thinking LoRA changes all weights; confusing it with quantization.
*Follow-up:* "What does the rank r control?" / "How do you serve many LoRA adapters efficiently?"

**B3. Q: What is catastrophic forgetting?**
*Ideal answer:* When fine-tuning on a narrow distribution shifts the weights enough that capabilities not represented in the fine-tuning data degrade — general reasoning, instruction-following, other output formats, refusal/safety behaviour, other languages. A model tuned hard for one classification task can get worse at explaining itself or at emitting the JSON wrapper you also rely on. PEFT reduces it; the defence is an eval that checks regression on general capability, not just the target-task gain.
*Why correct:* Names the mechanism, concrete examples, and the eval-based defence.
*Common mistakes:* Assuming fine-tuning only adds capability; not checking for regressions.
*Follow-up:* "How would you detect it before shipping?" / "Does LoRA eliminate it?"

**B4. Q: Roughly how many examples do you need for a task-specialisation SFT, and what matters more than the count?**
*Ideal answer:* Often 1k–10k good examples for task specialisation; fewer for format/tone. What matters far more than the count is quality: every completion is one you'd ship, format is perfectly consistent, the class/scenario distribution is balanced (or deliberately corrected), there are no train/test near-duplicates, and rare-but-important cases are represented. A few hundred pristine examples beat tens of thousands of noisy ones.
*Why correct:* Ballpark count plus the "data quality dominates" point with specifics.
*Common mistakes:* "More data is always better"; ignoring balance and format consistency.
*Follow-up:* "Why is format consistency across examples important?" / "What's the risk of a class-imbalanced training set?"

**B5. Q: What is distillation in the enterprise sense?**
*Ideal answer:* Using a large, capable "teacher" model to produce high-quality completions (and sometimes diverse inputs) for your task, then fine-tuning a small "student" model on those pairs so the student imitates the teacher on your distribution at much lower cost and latency. It's how you get a cheap 8B to act like an expensive 70B on a narrow task. Caveat: many hosted providers' terms forbid using their outputs to train another model — check before distilling a commercial model.
*Why correct:* Teacher→student via generated data, the cost/latency goal, and the ToS caveat.
*Common mistakes:* Confusing it with quantization; ignoring the terms-of-service issue.
*Follow-up:* "How do you know the student is good enough?" / "Where would synthetic teacher data mislead you?"

**B6. Q: When should you choose prompt engineering over fine-tuning?**
*Ideal answer:* When the base model can nearly do the task with a better prompt and a few examples; when you have fewer than a few hundred good examples; when the requirement will change often (fine-tuning has a slow iteration loop); or when you haven't yet proven a measured gap that prompting can't close. Prompt engineering is hours and near-free; fine-tuning is weeks plus data-curation and eval infrastructure and an ongoing retrain burden.
*Why correct:* The "cheaper lever first," low-example-count, and change-frequency criteria with the cost contrast.
*Common mistakes:* Jumping to fine-tuning for prestige or because prompting "feels hacky."
*Follow-up:* "You've maxed out prompting and still have a gap — what next?" / "What makes fine-tuning's iteration loop slow?"

**B7. Q: What is the difference between SFT and preference tuning (DPO/RLHF)?**
*Ideal answer:* SFT teaches "produce this output" from `(prompt, ideal_completion)` pairs — good for format, style, task mapping. Preference tuning teaches "prefer output A over output B" from preference pairs — good for harder-to-demonstrate qualities like helpfulness, not-over-refusing, or house judgement on ambiguous cases. RLHF does this via a trained reward model and RL (complex); DPO does it with a single direct loss on preference pairs (simpler, the common enterprise choice). You do SFT first, then DPO on top if a behavioural gap remains.
*Why correct:* Demonstration vs preference, the RLHF/DPO distinction, and the SFT-then-DPO order.
*Common mistakes:* Thinking RLHF is the only option; using preference tuning where SFT suffices.
*Follow-up:* "Where would an enterprise get preference data?" / "Why is DPO usually preferred over RLHF in-house?"

**B8. Q: What does "the data is the model" mean for SFT?**
*Ideal answer:* SFT quality is bottlenecked by the training data far more than by the model choice or hyperparameters — practitioners iterate on the dataset many times more than on the config. Bad examples teach bad behaviour directly; the example distribution becomes what the model optimises toward; inconsistent format teaches the model that format is optional. So the work is curation: correctness, consistency, coverage, balance, dedup, no leakage.
*Why correct:* The bottleneck claim and what "curation" concretely means.
*Common mistakes:* Focusing on learning rate/epochs; treating data collection as a one-time step.
*Follow-up:* "What would you check in a training set before the first run?" / "How does a skewed training distribution show up later?"

**B9. Q: Why must the fine-tuning eval set reflect the production distribution rather than being a random split of the training data?**
*Ideal answer:* If the training pool is skewed (e.g. dominated by common cases) or time-mixed (older examples under an obsolete rubric), a random split gives the validation set the same skew — so a high aggregate score is a true number about the wrong population, and a concentrated failure in a rare, high-consequence class is invisible. The eval set should be built to match production, over-sample the rare-critical cases enough to measure them, be split by time for time-flavoured data, and be hand-audited to the current standard.
*Why correct:* Explains the inherited-skew problem and the constructed-eval-set fix.
*Common mistakes:* Trusting an 80/10/10 random split; one aggregate metric.
*Follow-up:* "How do you get enough rare-class examples for the eval set?" / "Why split by time?"

**B10. Q: What should be recorded together as the release evidence for a fine-tuned model?**
*Ideal answer:* The exact base model version, the adapter (or merged weights) by hash, the training-data snapshot/version, and the eval-gate result — as one linked record. All four must line up: a provider base-model update against an old adapter, or an eval run against a different data snapshot, silently invalidates the others.
*Why correct:* The four-part pinned tuple and why the linkage matters.
*Common mistakes:* Recording only the adapter; not pinning the base version.
*Follow-up:* "What breaks if the base model is updated by the provider?" / "Why version the training data?"

### Intermediate (10)

**I1. Q: Walk through the decision for: "our support bot gives correct answers but not in our house tone, and it doesn't know our current product catalogue."**
*Ideal answer:* Two separate gaps. The **catalogue** is knowledge that changes → RAG over the product data; do not fine-tune on it. The **house tone** is behaviour → first try a stronger system prompt with 3–5 tone exemplars; if at your volume that's inconsistent, do a small SFT (LoRA) on a few hundred `(query, on-tone answer)` pairs, keeping the answers factually neutral so you're teaching tone not facts. Combine: RAG supplies the catalogue context, the fine-tune supplies the tone. Gate on an eval that checks tone adherence *and* that RAG grounding/accuracy didn't regress *and* general capability didn't regress.
*Why correct:* Splits knowledge (RAG) from behaviour (prompt→small SFT), combines them, and gates on a multi-axis eval.
*Common mistakes:* One fine-tune for both; fine-tuning on the catalogue.
*Follow-up:* "How do you build the tone training set without also teaching stale facts?" / "What if tone and accuracy trade off in the eval?"

**I2. Q: Explain LoRA rank and which modules to adapt, and how you'd choose.**
*Ideal answer:* Rank `r` is the dimensionality of the low-rank update — higher `r` gives the adapter more capacity to change behaviour but more trainable parameters, more overfitting risk on small data, and more catastrophic forgetting. Start low (8–16) for format/tone, go higher (32–64) for harder task shifts, and let the eval decide. Which modules: the attention projections (`q,k,v,o`) are the standard baseline; adding the MLP/feed-forward projections increases capacity for larger adaptations at more cost. `alpha` scales the update (often `r` or `2r`). Choose by sweeping a small grid and picking the smallest `r`/module-set that meets the eval, to minimise forgetting and serving cost.
*Why correct:* Rank as capacity/overfit/forgetting trade, module choice, and "smallest that passes the eval."
*Common mistakes:* Cranking `r` for "better results"; adapting every module by default.
*Follow-up:* "You have 800 examples — high or low rank?" / "How does rank interact with catastrophic forgetting?"

**I3. Q: Your fine-tune scores 96% on validation but fails in production on rare cases. Diagnose the likely cause and the fix.**
*Ideal answer:* The validation set is almost certainly a random split of a skewed training pool, so it shares the skew — the 96% is carried by the majority classes and the rare classes have too few validation examples to reveal low per-class recall. Likely compounded by label drift over time if the data spans years. Fix: build a held-out eval set that reflects production, over-sampled on the rare-critical classes and re-labelled to the current standard; sign off on per-class precision/recall with floors on the consequential classes, not an aggregate; rebalance training (oversample / class-weighted loss / reviewed synthetic examples for thin classes); add margin-based fallback-to-human for low-confidence majority-class predictions where the miss is asymmetric.
*Why correct:* Identifies inherited skew + possible label drift, and prescribes a constructed sliced eval, rebalancing, and asymmetric thresholds.
*Common mistakes:* "Add more data" without addressing balance or the eval-set construction; keeping aggregate sign-off.
*Follow-up:* "How many rare-class examples do you need to trust per-class recall?" / "Why an asymmetric decision threshold here?"

**I4. Q: When is distillation the right move, and how do you validate the student?**
*Ideal answer:* When a large model does your narrow task well but is too expensive/slow at your volume, and you have (or the teacher can generate) enough representative inputs. Generate teacher completions on your input distribution, SFT the student, and validate the student **against the teacher** on the target eval set — task metrics sliced by segment, format adherence, and the rare/hard cases — then decide the cost/quality trade explicitly with the business (e.g. "30% cheaper, 1pt lower recall on class X — acceptable?"). Also check general-capability regression, and check the teacher's provider terms permit training from its outputs.
*Why correct:* The cost/latency trigger, teacher-generated data, student-vs-teacher sliced eval, explicit trade decision, ToS check.
*Common mistakes:* Shipping the student on an aggregate number; ignoring the trade decision; ToS violation.
*Follow-up:* "The student matches the teacher on average but is worse on the 5% hardest inputs — ship it?" / "How do you make the teacher generate diverse inputs?"

**I5. Q: How do you split data for a fine-tune when the examples are time-stamped (tickets, filings, transactions)?**
*Ideal answer:* Split **by time**: train on the older window, validate/test on the most recent window, so you measure the model's ability to generalise to the *future* (which is what production is) rather than to interpolate within a shuffled distribution. A random split leaks near-future information and label conventions into training and inflates the score. Also check for label-rubric changes across the timeline and align the eval set (and possibly the training set) to the current rubric. Watch for near-duplicates spanning the boundary.
*Why correct:* Temporal split rationale, the leakage a random split causes, and the rubric-drift check.
*Common mistakes:* Random shuffle split; ignoring rubric changes over the timeline.
*Follow-up:* "What if the most recent period is too small to evaluate rare classes?" / "How does this connect to Module 184's drift discussion?"

**I6. Q: A provider updates the base model you fine-tuned a LoRA adapter against. What's the risk and what do you do?**
*Ideal answer:* The adapter was trained to transform the *old* base's activations; applied to a new base with shifted internals, the combination can degrade — sometimes subtly, sometimes badly — with no error. This is Module 162 §14's "pinned isn't as pinned as it sounds" recurring at the adapter/base seam. Do: pin the exact base version in the model registry as part of the release tuple; treat a base update as a model change requiring re-running the full eval gate with the adapter on the new base (and likely re-training the adapter on the new base); keep the old base+adapter deployable for rollback; add a behaviour canary that would catch silent drift.
*Why correct:* Names the activation-mismatch risk, the pinning discipline, and re-eval/re-train + rollback.
*Common mistakes:* Assuming an adapter is base-version-agnostic; not pinning the base.
*Follow-up:* "How would you detect this drift in production?" / "Merged weights vs separate adapter — does it change the risk?"

**I7. Q: What are the security implications of putting client PII in a fine-tuning dataset?**
*Ideal answer:* Data in the weights is neither access-controlled nor deletable. The model can memorise and regurgitate training records verbatim or under extraction attacks; a data-subject deletion request can't be honoured without retraining from a cleaned snapshot; and the adapter file, being small, is easy to exfiltrate and carries data-derived signal. Mitigations: scrub/pseudonymise training data, minimise sensitive fields, prefer RAG (retrieved from a deletable, access-controlled store) for anything personal, test the model for memorisation, and treat adapters as crown-jewel artefacts. The default: keep sensitive and deletable data out of training; fine-tune for behaviour.
*Why correct:* Memorisation/extraction, right-to-be-forgotten, adapter IP, and the "keep it in RAG" default.
*Common mistakes:* Treating training data like any other dataset; assuming the model won't memorise.
*Follow-up:* "How do you test a model for training-data memorisation?" / "A subject requests deletion — what's your actual process?"

**I8. Q: How do you decide between managed fine-tuning (a provider/cloud FT API) and running your own training?**
*Ideal answer:* Default to managed: it removes the training-infra burden, handles the LoRA/QLoRA recipe, and integrates with the hosted serving path. Run your own when: data residency forbids sending training data to the provider; you need a custom recipe (unusual objective, continued pretraining, a specific PEFT variant); you're fine-tuning an open-weight model with no managed option; or scale (dozens of teams, frequent retrains) justifies a training platform. Even then, keep it minimal — a job queue plus LoRA on a small GPU pool, not a bespoke framework.
*Why correct:* Managed-by-default with the specific triggers for self-run and a "keep it minimal" caveat.
*Common mistakes:* Building training infra for one fine-tune; sending regulated data to a managed API without checking residency.
*Follow-up:* "You have a residency constraint but only two fine-tunes — what's the lightest self-run setup?" / "What do you lose by going managed?"

**I9. Q: What is multi-LoRA serving and when do you use it?**
*Ideal answer:* Keeping one base model resident in GPU memory and many small LoRA adapters, selecting the right adapter per request (per tenant, per task, per region), with the serving framework batching across adapters. You use it when you need many behavioural variants without paying for N full copies of a large base model — e.g. a per-team fine-tune for 20 teams. Trade-off: batches spanning many adapters lose some batching efficiency, so high-volume adapters may be better merged into their own dedicated pools.
*Why correct:* One base + many adapters + per-request selection, the "variants without N copies" use case, and the batching-efficiency trade.
*Common mistakes:* Deploying a separate full model per variant; ignoring the adapter-diverse-batch cost.
*Follow-up:* "One adapter gets 80% of traffic — what would you do?" / "How does the serving layer pick the adapter?"

**I10. Q: You fine-tuned for a classification task and now the model is worse at producing the JSON envelope the pipeline expects. What happened and how do you prevent it next time?**
*Ideal answer:* Catastrophic forgetting — the SFT data was all bare class labels, so the model's weights shifted away from the JSON-wrapping behaviour it had before. Prevent it: include the exact production output format (the JSON envelope) in *every* training example so the target behaviour is reinforced, not eroded; keep a modest LoRA rank and few epochs; and add format-adherence (schema-valid rate) and other-format capability to the eval gate so a regression blocks the release. If you need many output formats, represent them in the training mix.
*Why correct:* Diagnoses forgetting from format-narrow data, fixes with format-in-every-example + conservative training + format in the eval gate.
*Common mistakes:* Training on bare labels; no format check in the eval; blaming the model.
*Follow-up:* "Why does putting the format in every example help?" / "What else would you add to the regression suite?"

### Advanced (10)

**A1. Q: Design the end-to-end pipeline and gates for producing and maintaining a fine-tuned model in a regulated environment.**
*Ideal answer:* (1) **Problem gate** — document that the cheaper levers (prompt, RAG) were tried and a measured gap remains; state the target metric and the alternative being beaten. (2) **Data curation** — sources with provenance, DLP scrub of sensitive fields, dedup, format normalisation, class-balance report, **temporal + leakage-safe split**, hand-audit of the eval set to the current rubric with rare-class over-sampling; snapshot and version the dataset. (3) **Training** — pinned base version, LoRA/QLoRA, small hyperparameter sweep, early stopping on the real held-out set. (4) **Eval gate** (Module 184) — target-task gain sliced with floors on consequential slices, general-capability regression, format adherence, contamination check, comparison to the cheaper alternative; PASS/FAIL with a report and named approver. (5) **Registry** — pin `{base version, adapter hash, data snapshot, eval report}` as one record; sign it. (6) **Rollout** — canary → progressive on the serving platform (Module 182), automated rollback on metric regression, old version kept hot. (7) **Monitoring** — drift on the input distribution and on agreement with later human corrections; a defined retrain trigger. (8) **Change control** — the whole thing is a SOX-governed change with a named accountable human, four-eyes on the eval sign-off, and an audit trail.
*Why correct:* Every stage with its gate, the pinned tuple, canary rollout, drift-triggered retrain, and the change-control overlay.
*Common mistakes:* No problem gate; random split; aggregate-only eval; no retrain plan; no rollback.
*Follow-up:* "What's the retrain trigger?" / "Who signs off the eval and on what evidence?"

**A2. Q: A stakeholder insists on fine-tuning the model on 50,000 internal policy documents "so it just knows our policies." Talk them through why that's the wrong lever and what you'd do instead.**
*Ideal answer:* Fine-tuning on documents teaches the model the *style* of the documents and lets it memorise some facts unreliably, with no confidence signal — so it will answer policy questions fluently and confidently, and be wrong an unpredictable fraction of the time, in your house voice, which makes the errors harder to catch. It also goes stale the instant a policy changes, requiring a full retrain, and you can't cite a source. The right design is RAG: index the policy documents, retrieve the relevant passages per query, and have the model answer *grounded in and citing* those passages (Module 164). If the *style* of the answers also needs work, a small separate SFT on tone — not facts — can sit on top. Offer a quick demo: RAG answering a policy question with a citation vs the fine-tune confabulating one.
*Why correct:* Explains style-not-facts, unreliable memorisation, staleness, no citations; prescribes RAG (+ optional tone SFT) with a demo.
*Common mistakes:* Agreeing to it; not offering the concrete RAG alternative; not addressing the staleness/citation points.
*Follow-up:* "They say RAG retrieval sometimes misses — how is that better than a fine-tune?" / "When, if ever, would document fine-tuning make sense?"

**A3. Q: How do you build the held-out evaluation set for a high-stakes classification fine-tune so it actually protects you?**
*Ideal answer:* Not a random split. Construct it to (1) **match the production distribution** of inputs (channel, format, language, time period = now), (2) **over-sample the rare, high-consequence classes** enough for statistically meaningful per-class recall (pull from a longer history, re-label to the current rubric), (3) be **hand-audited** by domain experts against the current standard, (4) be **frozen and versioned** separately from training with access control, (5) include **adversarial/edge cases** and known hard confusions, (6) be **split by time** so it tests generalisation to the future. Sign-off is on per-class precision/recall with hard floors on the consequential classes and no aggregate-only approval. Re-audit and refresh it on a cadence as the world moves.
*Why correct:* Every property that makes an eval set protective — production match, rare-class over-sampling, hand-audit, isolation, adversarial coverage, temporal split, sliced sign-off.
*Common mistakes:* Random split; aggregate metric; letting the eval set drift or leak.
*Follow-up:* "How big does the rare-class sample need to be?" / "How often do you refresh it?"

**A4. Q: Explain how you'd use preference tuning (DPO) in an enterprise setting, including where the data comes from and the risks.**
*Ideal answer:* Do SFT first for the task/format. Reach for DPO when a *behavioural* gap remains — the model over-refuses legitimate queries, keeps adding unwanted disclaimers, or makes the wrong call on ambiguous cases where the business has a defined stance. **Data source**: human review logs — every time a reviewer picks rewrite A over draft B, that's a preference pair; also explicit thumbs-up/down (KTO if you only have that). **Process**: DPO (single direct loss on `(prompt, chosen, rejected)`, no reward model or RL loop — stable and simple). **Risks**: DPO can regress task accuracy and factuality while improving the preferred behaviour, can over-fit to the preferences of whoever labelled, and can amplify a bias in the preference data (e.g. reviewers preferring longer answers). Mitigate with a held-out eval covering task accuracy, safety, and factuality alongside the preference metric, and a diverse labelling pool.
*Why correct:* SFT-first, the behavioural triggers, review logs as the data source, DPO over RLHF, and the regression/over-fit/bias risks with mitigations.
*Common mistakes:* Jumping to RLHF; using DPO for a task SFT would solve; no factuality/safety regression check.
*Follow-up:* "Reviewers systematically prefer longer answers — what happens and how do you catch it?" / "Why DPO over RLHF in-house?"

**A5. Q: A fine-tuned model's production accuracy has slowly declined over five months with no code or model change. Walk the investigation.**
*Ideal answer:* Candidates, checked in order: (1) **Input distribution drift** — the mix of inputs has shifted (new product, new channel, seasonal), so the model sees cases under-represented in training. Compare recent input feature/embedding distributions to the training snapshot. (2) **Label/rubric drift** — what counts as the right answer has changed; the model is now "wrong" against a moved target. Check for policy/definition changes and re-audit recent human corrections. (3) **Silent base-model update** (if using a hosted base with an adapter) — the provider changed the base; adapter+new-base degrades (Module 162 §14). Check base version history; re-run the eval with the current base. (4) **Upstream data-quality change** — an OCR/parsing/normalisation change upstream altered the input the model receives. (5) **Eval-set staleness** — the offline eval still passes because it's stale, so the decline is invisible to the gate. Fix per cause; add a drift monitor on inputs and on agreement-with-human-corrections, and refresh the eval set.
*Why correct:* Ordered differential — input drift, label drift, base update, upstream change, stale eval — with checks and fixes.
*Common mistakes:* Assuming the model "wore out"; only retraining without finding which drift; not suspecting a base update.
*Follow-up:* "How would a drift monitor have caught this earlier?" / "Which of these does a retrain actually fix?"

**A6. Q: Compare full fine-tuning, LoRA, and QLoRA on the axes that decide the choice for a 13B model task specialisation.**
*Ideal answer:* **Quality ceiling**: full FT highest for large behaviour shifts; LoRA usually matches it for task specialisation; QLoRA slightly below LoRA due to the 4-bit frozen base, usually within noise. **Compute/memory**: full FT multi-GPU, heavy; LoRA single high-end GPU; QLoRA single mid GPU. **Catastrophic forgetting**: full FT worst (all weights move); LoRA/QLoRA much less (base frozen). **Serving**: full FT = a new full model to host; LoRA/QLoRA = a small adapter, mergeable or multi-adapter-servable. **Iteration speed**: LoRA/QLoRA far faster to train, so more data-curation passes. Decision: default LoRA (or QLoRA if GPU-constrained); use full FT only if the eval shows LoRA leaving material quality on the table for this task, accepting the forgetting and serving cost.
*Why correct:* Quality/compute/forgetting/serving/iteration axes with a clear default and the exception condition.
*Common mistakes:* Full FT by reflex; assuming QLoRA is much worse; ignoring the serving-variant advantage of adapters.
*Follow-up:* "What eval result would push you to full FT?" / "How does the serving story differ downstream?"

**A7. Q: You want an 8B model to replace a 70B for a grounded-Q&A workload (Module 182 §15). Design the distillation and the go/no-go.**
*Ideal answer:* (1) **Inputs**: sample real production queries + their retrieved contexts across the full topic/segment range; if thin, have the 70B generate additional diverse queries, reviewed. (2) **Teacher outputs**: run the 70B with the production prompt on each `(query, context)`, capturing grounded answers with citations; filter out low-quality teacher outputs (a teacher isn't perfect). (3) **Student SFT**: LoRA fine-tune the 8B on `(query+context → grounded answer)`, format identical to production. (4) **Eval gate**: on a hand-audited held-out set — answer correctness (grounded, sliced by topic and by hard/rare), citation accuracy, hallucination rate, format adherence, general-capability regression — student **vs the 70B** as baseline. (5) **Go/no-go**: defined thresholds agreed with the business (e.g. correctness within 1pt of the 70B overall, no critical topic slice regresses > 0.5pt, hallucination rate not higher), *and* the projected tokens/$/latency win is real. (6) **Rollout**: confidence-routed — low-confidence or flagged-hard queries go to the 70B (Module 182 §15); canary → progressive; monitor the routed-up fraction and per-slice quality.
*Why correct:* Data (real + reviewed synthetic), filtered teacher outputs, LoRA SFT, sliced student-vs-teacher eval with agreed thresholds, confidence-routed rollout with monitoring.
*Common mistakes:* No teacher-output filtering; aggregate-only go/no-go; no fallback route; not checking the cost win is real.
*Follow-up:* "The student is within 1pt overall but 4pt worse on one regulatory topic — what do you do?" / "How do you set the confidence threshold for routing up?"

**A8. Q: What is genuinely new about adaptation risk versus the rest of this domain, and what is a re-instance of a known pattern?**
*Ideal answer:* **Re-instances**: training-set class skew biasing predictions is Module 163 §4's few-shot distribution bias, now permanent in weights; the random-split eval hiding the skew is the "aggregate cannot detect a concentrated failure" pattern (Modules 132/133/176/177); an adapter against a silently-updated base is Module 162 §14's "pinned isn't pinned"; "we can't regenerate it" is the non-determinism/archival discipline. **Genuinely new**: adaptation **moves data from a deletable, access-controlled store (RAG) into the weights, where it is neither** — creating a right-to-be-forgotten problem and a memorisation/extraction surface that no prior module had, because prior modules kept knowledge in retrievable stores. And **catastrophic forgetting** is a new failure *mechanism* — improving the target task actively degrades unrelated capabilities, so a change that is purely additive in intent is subtractive in effect, which the eval must specifically be built to catch. The synthesis: the *data-quality and evaluation* failures are familiar shapes, but baking behaviour and data into weights introduces irreversibility and capability-regression risks that are structurally new.
*Why correct:* Separates the re-instanced data/eval failures from the new irreversibility (data-in-weights) and capability-regression (forgetting) risks.
*Common mistakes:* Claiming it's all new; missing that the skew/eval failures are known shapes.
*Follow-up:* "Why is data-in-weights worse than data-in-RAG for compliance?" / "How is forgetting different from a normal regression?"

**A9. Q: How would you know if a fine-tuned model is slowly getting worse in production, before an audit finds it?**
*Ideal answer:* Instrument the trend, don't wait for the gate. (1) **Input drift**: distance between recent input embeddings/features and the training snapshot, per segment. (2) **Agreement with human corrections**: for any path with downstream human review or later ground truth (a queue reassignment, an overturned decision), track the rolling agreement rate, sliced by class — a decline in a consequential class is the signal. (3) **Confidence distribution shift**: the model's own score distribution moving (more low-margin predictions). (4) **Format-adherence rate** trending down (forgetting creeping, or input drift). (5) **Fallback-to-human / routed-up rate** creeping up. (6) **Periodic re-eval** on a *refreshed* held-out set, not the frozen launch one. Alert on trend divergence, review on a cadence with the numbers sliced. Same discipline as everywhere in this course: a slow degradation that each day looks normal is invisible unless you trend the thing it erodes.
*Why correct:* Names the specific drift signals (input distance, human-agreement, confidence shift, format rate, fallback rate, refreshed re-eval) and trend alerting.
*Common mistakes:* Relying on the frozen launch eval; only aggregate accuracy; no per-class human-agreement tracking.
*Follow-up:* "You see human-agreement dropping on one class — is that model drift or rubric drift, and how do you tell?" / "What triggers a retrain vs an investigation?"

**A10. Q: A team distilled a hosted commercial model into an in-house 8B to cut costs, and it works well. What's your review as the Principal?**
*Ideal answer:* Technically fine, but two issues to resolve before it's sanctioned. (1) **Terms of service**: most hosted providers' terms prohibit using their outputs to train another model, especially one that could be seen as competing or that's redistributed. This is a legal/contract question — get it reviewed; if the terms forbid it, the model can't ship regardless of quality, and there may be remediation needed for what's already built. Prefer an open-weight or owned teacher going forward. (2) **Governance parity**: the in-house model is now a production model change and needs the full treatment — pinned base+adapter+data+eval tuple, an eval gate with sliced metrics and general-capability regression, drift monitoring, a retrain plan, and change-control sign-off. If both clear, it's a good cost move (Module 182 §15). Also confirm the teacher-generated training data didn't capture anything sensitive that shouldn't be baked into weights (§8).
*Why correct:* Leads with the ToS/legal risk (can block it entirely), then governance parity, then the data-in-weights check — not just "nice, ship it."
*Common mistakes:* Approving on quality alone; missing the ToS issue; not applying the model-change governance.
*Follow-up:* "The terms are ambiguous — what do you do?" / "What remediation if it turns out the terms were violated?"

### Expert (FinTech Principal Panel)

**E1. Q: The firm wants a fine-tuning capability so many teams can adapt models for their workloads. As the Principal, what do you build, what do you deliberately not build, and what are the two decisions most likely to be wrong in 18 months?**
*Ideal answer:* **Build**: a thin platform — a dataset registry with provenance/versioning and automated validation (dedup, leakage, balance report, DLP scrub), a job runner defaulting to LoRA/QLoRA (managed FT API where residency allows, a small GPU pool where it doesn't), an **eval-gate service** (Module 184) that every fine-tune must pass on a real-distribution held-out set with sliced metrics + regression checks, a model registry pinning the `{base, adapter, data, eval}` tuple, and multi-LoRA serving (Module 182). Plus per-team metering/chargeback for training and teacher-distillation spend, and a drift-monitor + retrain-trigger template. **Don't build**: a bespoke training framework, a preference-tuning pipeline before anyone needs one, continued-pretraining infra, or a fine-tune for a problem RAG solves — put a "did you try RAG/prompting" gate at the front. **Two likely-wrong decisions**: (1) the **eval-set construction standard** — teams will default to random splits and aggregate metrics; the per-class-floors-on-real-distribution standard needs to be enforced by the gate and taught, or you get §4 incidents across teams. (2) the **build-vs-buy line for training** — managed FT APIs and base models improve fast; the choice to self-run training should be revisited on a schedule, per constraint, not treated as permanent, and the platform should keep the managed path as the default so switching is cheap.
*Why correct:* A thin platform with the eval gate as the centrepiece, an explicit "not build" list including the RAG gate, and two well-chosen future-wrong decisions with mitigations.
*Common mistakes:* Building a training framework; no front gate against unnecessary fine-tunes; treating self-run training as forever.
*Follow-up:* "How do you enforce the eval-set standard technically?" / "What triggers revisiting self-run training?"

**E2. Q: An auditor asks you to demonstrate that a fine-tuned model making regulated decisions was produced and controlled appropriately. What do you show?**
*Ideal answer:* (1) The **problem justification** — evidence the cheaper levers were tried and a measured gap remained, and the target metric. (2) The **dataset record** — sources with provenance, the DLP/scrub evidence, the versioned snapshot hash, the validation report (dedup, leakage, class balance), and the temporal split definition. (3) The **eval evidence** — the held-out set's construction (production-matched, rare-class over-sampled, hand-audited to the current rubric, isolated), the sliced per-class precision/recall against the floors, the general-capability regression results, the contamination check, and the named human approver. (4) The **registry record** — the pinned `{base version, adapter hash, data snapshot, eval report}` tuple, signed. (5) The **rollout record** — canary → progressive, the automated-rollback config, and that the prior version stayed available. (6) The **monitoring** — the drift signals tracked and the retrain trigger. (7) The **change-control ticket** — authorization, four-eyes on the eval sign-off, audit trail. (8) If distilled: the legal review of teacher-model terms. The narrative: justified, curated with provenance, evaluated on a distribution that reflects reality with floors on what matters, pinned, rolled out reversibly, monitored, and change-controlled.
*Why correct:* A complete, ordered evidence package covering justification, data provenance, eval construction + sliced results, pinned tuple, reversible rollout, monitoring, and change control.
*Common mistakes:* Showing the training config and an accuracy number; no eval-set construction evidence; no provenance; no rollback record.
*Follow-up:* "The eval set was built 14 months ago — is that acceptable?" / "Show me the per-class floor for the enforcement-referral class and why it's set there."

**E3. Q: Six months after launch, the fine-tuned classifier from §4 is retrained quarterly on a rolling window. An incident review finds the retrains have been slowly *drifting the decision boundary* because each quarter's training data is labelled partly by the *previous model's* outputs that humans only lightly corrected. What's happening and how do you fix the loop?**
*Ideal answer:* A **feedback loop / model-induced distribution shift**: the model's predictions influence the labels of the next training set (humans anchor on the model's suggestion and only override obvious errors), so the model increasingly trains on its own outputs, amplifying its biases and calcifying errors — especially in the rare classes where human attention is thin. The aggregate metrics look stable because the model agrees with data it shaped. Fixes: (1) **Break the anchoring** — for the training/eval label pipeline, have a fraction of items labelled *blind* (without the model's suggestion) by domain experts; use those as the ground truth for the eval set and a clean slice of training. (2) **Track label provenance** — mark each training example as "human-blind," "human-corrected-from-model," or "model-accepted"; monitor the mix and cap the model-influenced fraction. (3) **Golden set** — a fixed, blind-labelled, periodically-refreshed eval set that the model's outputs never touch, as the real gate. (4) **Measure drift of the decision boundary directly** — compare the current model's predictions on a frozen probe set to the launch model's. (5) Consider not retraining on model-influenced labels at all for the consequential classes — use only blind expert labels there. The principle: a model trained on labels it influenced will converge to self-agreement, not to correctness.
*Why correct:* Names the feedback-loop / label-anchoring mechanism, why metrics hide it, and fixes it with blind labelling, label provenance, an untouched golden set, and boundary-drift probing.
*Common mistakes:* "Just retrain more often" (makes it worse); trusting the aggregate stability; no label-provenance tracking.
*Follow-up:* "What fraction of blind labels do you need?" / "How is this different from ordinary data drift?"

**E4. Q: Argue both sides of "fine-tune a small model" vs "just use a better prompt on the frontier model" for a high-volume production task, then say how you decide.**
*Ideal answer:* **For the fine-tune**: at high volume, a fine-tuned small model can be 5–10× cheaper per token and lower latency (Module 182 §15), gives rock-solid format adherence, encodes house conventions that are tedious to prompt, and reduces dependence on a single frontier vendor's pricing and availability. **For the prompt-on-frontier**: zero training/eval/retrain infrastructure and lead time; instantly benefits from model upgrades; no catastrophic-forgetting or data-in-weights risk; no drift-retrain loop; and frontier models keep getting cheaper and better, so the cost gap may close on its own. **Decide by**: (1) volume and its trajectory — the fine-tune's fixed cost (curation + eval + retrain loop) only amortises above a real, sustained volume; (2) whether prompting *actually* fails the quality/format bar today (measure, don't assume); (3) how stable the task is — a task whose definition changes quarterly punishes the fine-tune's slow loop; (4) residency/vendor constraints. If prompting meets the bar and volume is uncertain, prompt on frontier and revisit; commit to the fine-tune when volume is proven, the task is stable, and the measured cost/quality/latency case clears the ongoing maintenance burden.
*Why correct:* Genuine both-sides (cost/format/vendor-independence vs zero-infra/upgrade-benefit/no-irreversibility), and a decision framed on volume trajectory, measured prompting adequacy, task stability, and constraints.
*Common mistakes:* One-sided; ignoring the retrain/maintenance burden; ignoring that frontier models improve under you.
*Follow-up:* "What sustained volume justifies the fixed cost?" / "The task definition changes every quarter — does that kill the fine-tune?"

**E5. Q: Give the single most discriminating interview question you'd ask a Principal candidate about model adaptation, and contrast a strong and weak answer.**
*Ideal answer:* Question: **"A team shows you a fine-tune with 96% validation accuracy that beats the base model. What do you ask before you'd let it near production?"** A **weak** answer takes the number at face value and asks about deployment mechanics. A **strong** answer interrogates the number: how was the eval set constructed — random split or built to reflect production? What are the *per-class* precision/recall, especially on the rare, consequential classes, and what are the floors? Does the training/eval data span a period where the labelling rubric changed? Was there general-capability regression testing, or just the target task? Is the base model version pinned, and what happens when the provider updates it? Was RAG or a better prompt actually tried and measured first? What's the retrain plan and drift monitor? The tell: a strong candidate treats an aggregate accuracy number as a claim to be decomposed — by class, by distribution, by time, by what it *didn't* measure — and knows the dangerous failures (rare-class misses, forgetting, base drift, inherited skew) are exactly the ones an aggregate hides.
*Why correct:* The question forces decomposition of a headline metric; the contrast identifies take-the-number-at-face-value as the weak tell.
*Common mistakes (weak answer):* Trusting 96%; asking only about rollout; not mentioning per-class floors, distribution match, forgetting, or the cheaper-alternative check.
*Follow-up:* "They only have 40 rare-class examples total — now what?" / "How would you re-run this eval in a year to know it's still valid?"

---

## 11. Coding Exercises

### Easy — LoRA parameter-count and training-memory estimator

**Problem.** Given a model's hidden size, number of layers, which modules are adapted, and LoRA rank, compute the trainable parameter count and a rough training-memory estimate; compare to full fine-tuning.

```python
from dataclasses import dataclass

@dataclass
class LoraPlan:
    d_model: int
    n_layers: int
    rank: int
    adapt_attn: bool = True      # q,k,v,o : 4 matrices of ~ d_model x d_model
    adapt_mlp: bool = False      # up,down : ~ 2 matrices of d_model x (4*d_model)
    base_params: int = 0         # total base params (for the comparison)
    base_dtype_bytes: int = 2

def lora_trainable_params(p: LoraPlan) -> int:
    per_layer = 0
    if p.adapt_attn:
        # each adapted matrix W (d x d) -> A (r x d) + B (d x r) = 2*r*d
        per_layer += 4 * (2 * p.rank * p.d_model)
    if p.adapt_mlp:
        # up:  d x 4d  -> A (r x d) + B (4d x r)     ;  down: 4d x d similar
        per_layer += 2 * (p.rank * p.d_model + p.rank * 4 * p.d_model)
    return per_layer * p.n_layers

def training_bytes(trainable: int, base_params: int, base_dtype_bytes: int,
                   full_finetune: bool) -> int:
    if full_finetune:
        # weights + grads (same dtype) + Adam m,v (fp32) ≈ 2+2+8 = ~12 bytes/param
        return base_params * 12
    # LoRA: frozen base weights (read-only) + tiny adapter grads + Adam on adapters
    frozen = base_params * base_dtype_bytes
    adapter = trainable * (2 + 2 + 8)      # weight+grad+Adam(m,v fp32)
    return frozen + adapter

# Llama-3-8B-ish
plan = LoraPlan(d_model=4096, n_layers=32, rank=16, base_params=8_000_000_000)
tr = lora_trainable_params(plan)
print(tr, f"{tr / plan.base_params:.4%}")                       # ~13.4M  (~0.17%)
print(training_bytes(tr, plan.base_params, 2, full_finetune=False) / 2**30, "GiB")  # ~15-16 GiB
print(training_bytes(0,  plan.base_params, 2, full_finetune=True)  / 2**30, "GiB")  # ~90+ GiB
```

*Time / space:* O(1). *Optimised:* add a `qlora=True` path that sets `base_dtype_bytes≈0.5` (4-bit) to show a 70B QLoRA fitting in ~48–70 GiB; sweep `rank` and module choice to plot trainable% vs rank.

### Medium — SFT dataset validator (format, dedup, leakage, class balance)

**Problem.** Given `train` and `eval` lists of `{prompt, completion, label}`, report: format-consistency violations, exact and near-duplicate pairs, train↔eval leakage (near-duplicates spanning the split), and the class-balance table with a warning for any class below a threshold.

```python
import hashlib, re
from collections import Counter

def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())

def _shingles(s: str, k: int = 5) -> set[str]:
    toks = _norm(s).split()
    return {" ".join(toks[i:i+k]) for i in range(max(1, len(toks) - k + 1))}

def _jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if (a or b) else 0.0

def validate_sft(train: list[dict], eval_: list[dict],
                 min_class_frac: float = 0.05, dup_threshold: float = 0.9) -> dict:
    report: dict = {"format": [], "dupes": [], "leakage": [], "balance": {}, "warnings": []}

    # format consistency: completion should match a single schema shape (here: JSON-ish check)
    def looks_json(s): return s.strip().startswith("{") and s.strip().endswith("}")
    json_votes = sum(looks_json(r["completion"]) for r in train)
    schema_is_json = json_votes > len(train) / 2
    for i, r in enumerate(train):
        if looks_json(r["completion"]) != schema_is_json:
            report["format"].append((i, "completion schema shape inconsistent with majority"))

    # exact dupes within train
    seen: dict[str, int] = {}
    for i, r in enumerate(train):
        h = hashlib.sha256((_norm(r["prompt"]) + "\x00" + _norm(r["completion"])).encode()).hexdigest()
        if h in seen:
            report["dupes"].append((seen[h], i, "exact"))
        else:
            seen[h] = i

    # near-dupes + leakage via shingles (O(n*m) — fine for a validator; index for scale)
    train_sh = [(_shingles(r["prompt"]), i) for i, r in enumerate(train)]
    for j, e in enumerate(eval_):
        esh = _shingles(e["prompt"])
        for tsh, i in train_sh:
            if _jaccard(esh, tsh) >= dup_threshold:
                report["leakage"].append((i, j, "eval prompt near-duplicates a train prompt"))

    # class balance
    counts = Counter(r["label"] for r in train)
    total = sum(counts.values())
    for label, c in counts.items():
        frac = c / total
        report["balance"][label] = {"count": c, "frac": round(frac, 4)}
        if frac < min_class_frac:
            report["warnings"].append(f"class '{label}' is {frac:.1%} of train (< {min_class_frac:.0%}) "
                                      f"— rare-class recall will be unreliable; oversample or weight")
    return report
```

*Complexity:* O(n·m) for the naive leakage check; use a shingle index / MinHash-LSH for large sets. *Optimised:* the point is that this runs as a mandatory CI gate before any training job — a `warnings` entry or any `leakage` entry blocks the run. Extend with a temporal-split check (Hard exercise).

### Hard — Held-out-by-time splitter that prevents temporal + rubric leakage

**Problem.** Given timestamped labelled examples and a known `rubric_change_date`, produce train / val / test splits such that: test is the most recent window, no example spans a near-duplicate across splits, and examples before `rubric_change_date` are excluded from val/test (and optionally re-labelled or dropped from train).

```python
from dataclasses import dataclass
from datetime import date

@dataclass(frozen=True)
class Example:
    id: str
    ts: date
    prompt: str
    label: str
    rubric_version: int          # 1 = old, 2 = current

def time_split(examples: list[Example], rubric_change: date,
               val_frac: float = 0.15, test_frac: float = 0.15,
               drop_old_rubric_from_train: bool = False) -> dict[str, list[Example]]:
    ex = sorted(examples, key=lambda e: e.ts)
    n = len(ex)
    n_test = int(n * test_frac)
    n_val = int(n * val_frac)
    train_pool = ex[: n - n_val - n_test]
    val_pool = ex[n - n_val - n_test : n - n_test]
    test_pool = ex[n - n_test :]

    # val/test MUST be current-rubric only (else you evaluate against a moved target)
    val = [e for e in val_pool if e.ts >= rubric_change and e.rubric_version == 2]
    test = [e for e in test_pool if e.ts >= rubric_change and e.rubric_version == 2]

    train = train_pool
    if drop_old_rubric_from_train:
        train = [e for e in train if e.rubric_version == 2]

    # de-leak: remove any train example whose prompt exactly matches a val/test prompt
    holdout_prompts = {e.prompt.strip().lower() for e in val + test}
    train = [e for e in train if e.prompt.strip().lower() not in holdout_prompts]

    # guardrails
    warnings = []
    if len(test) < 200:
        warnings.append(f"only {len(test)} current-rubric test examples — per-class recall unreliable; "
                        f"pull more recent data or re-label older items to rubric v2")
    from collections import Counter
    for label, c in Counter(e.label for e in test).items():
        if c < 30:
            warnings.append(f"test class '{label}' has {c} examples — over-sample it for a meaningful floor")

    return {"train": train, "val": val, "test": test, "warnings": warnings}
```

*Complexity:* O(n log n) sort + O(n) passes. *Optimised:* replace exact-prompt de-leak with the Medium exercise's shingle check; add a per-class over-sampling step for the test set that pulls extra current-rubric rare-class items from a reserved pool; emit the final per-class test counts so the reviewer sets floors with eyes open (the §4 lesson).

### Expert — Multi-LoRA adapter router with per-adapter capacity and fallback

**Problem.** Route each request to the correct LoRA adapter on a shared base model. Support: per-tenant adapter selection, a cap on how many distinct adapters can be "hot" (loaded) at once (LRU eviction), a merged-pool fast path for a high-volume adapter, and a fallback to the base model if a tenant has no adapter or the adapter failed its eval gate.

```python
from collections import OrderedDict
from dataclasses import dataclass, field

@dataclass
class Adapter:
    id: str
    tenant_id: str
    eval_state: str              # "PASS" | "FAIL" | "PENDING"
    base_version: str
    merged_pool: bool = False    # this adapter has its own dedicated merged pool

@dataclass
class Route:
    kind: str                    # "MERGED_POOL" | "MULTI_LORA" | "BASE_FALLBACK"
    adapter_id: str | None = None
    reason: str = ""

class MultiLoraRouter:
    def __init__(self, base_version: str, max_hot_adapters: int = 32):
        self.base_version = base_version
        self.max_hot = max_hot_adapters
        self._by_tenant: dict[str, Adapter] = {}
        self._hot: "OrderedDict[str, Adapter]" = OrderedDict()   # LRU of loaded adapters
        self.metrics = {"merged": 0, "multilora": 0, "fallback": 0, "evicted": 0}

    def register(self, a: Adapter) -> None:
        self._by_tenant[a.tenant_id] = a

    def route(self, tenant_id: str) -> Route:
        a = self._by_tenant.get(tenant_id)
        if a is None:
            self.metrics["fallback"] += 1
            return Route("BASE_FALLBACK", reason="no adapter for tenant")
        if a.eval_state != "PASS":
            self.metrics["fallback"] += 1
            return Route("BASE_FALLBACK", reason=f"adapter eval_state={a.eval_state}")
        if a.base_version != self.base_version:
            # adapter trained against a different base — do NOT silently serve it
            self.metrics["fallback"] += 1
            return Route("BASE_FALLBACK", reason="adapter/base version mismatch")
        if a.merged_pool:
            self.metrics["merged"] += 1
            return Route("MERGED_POOL", a.id, "dedicated merged pool")
        # multi-LoRA path: ensure the adapter is hot (LRU load/evict)
        if a.id in self._hot:
            self._hot.move_to_end(a.id)
        else:
            if len(self._hot) >= self.max_hot:
                evicted_id, _ = self._hot.popitem(last=False)
                self.metrics["evicted"] += 1
            self._hot[a.id] = a
        self.metrics["multilora"] += 1
        return Route("MULTI_LORA", a.id, "hot in multi-LoRA pool")

def _selftest():
    r = MultiLoraRouter(base_version="llama3-8b@2026-06")
    r.register(Adapter("ad-A", "tenant-A", "PASS", "llama3-8b@2026-06"))
    r.register(Adapter("ad-B", "tenant-B", "FAIL", "llama3-8b@2026-06"))
    r.register(Adapter("ad-C", "tenant-C", "PASS", "llama3-8b@2026-05"))   # stale base
    r.register(Adapter("ad-D", "tenant-D", "PASS", "llama3-8b@2026-06", merged_pool=True))
    assert r.route("tenant-A").kind == "MULTI_LORA"
    assert r.route("tenant-B").kind == "BASE_FALLBACK"      # failed eval -> never served
    assert r.route("tenant-C").kind == "BASE_FALLBACK"      # base mismatch -> never served (§I6)
    assert r.route("tenant-D").kind == "MERGED_POOL"
    assert r.route("tenant-Z").kind == "BASE_FALLBACK"      # unknown tenant
```

*Complexity:* O(1) per route. *Optimised:* pre-warm the top-N adapters by historical volume so cold-load latency doesn't hit the hot path; emit per-adapter eviction-churn and fallback-reason counters (a rising `fallback` with `reason="version mismatch"` means a base update went out without re-training adapters — the §14 signal); promote an adapter to `merged_pool` automatically when its traffic share crosses a threshold. The structural guarantee: a `FAIL`/`PENDING` adapter and a base-version-mismatched adapter are **unroutable** — the model change gate and the base-pinning discipline are enforced by control flow, not convention.

---

## 12. System Design — A Model-Adaptation Platform (Curate → Train → Eval-Gate → Register → Serve)

*(Four-step Pragmatic Engineer spine.)*

### Step 1 — Understand the problem and establish design scope

**Candidate ↔ interviewer dialogue**

> **Q:** Are we building the training framework, or a platform on top of existing tools?
> **A:** A platform. Use a managed fine-tuning API where residency allows, and a small in-house LoRA runner where it doesn't. You own curation, gating, registry, serving integration, and the retrain loop.
> **Q:** Who are the users?
> **A:** ~15 internal engineering teams, each wanting to adapt models for a specific workload — classification, extraction, house-style generation. Not ML researchers; they need guardrails.
> **Q:** What kinds of adaptation are in scope?
> **A:** SFT via LoRA/QLoRA, and response-based distillation (big model → small model). Preference tuning and continued pretraining are out of scope for v1 — add later if a real need appears.
> **Q:** What's explicitly out?
> **A:** The serving infrastructure itself (Module 182), the eval framework internals (Module 184 — we consume it as a gate), and the application/prompt logic.
> **Q:** Constraints?
> **A:** Regulated environment: SOX change control on any model making regulated decisions; data residency for training data on some workloads; a fixed annual budget for training + teacher-distillation compute.
> **Q:** What does "done" look like for one fine-tune?
> **A:** A registered, eval-gate-PASS `{base, adapter, data-snapshot, eval-report}` tuple, deployed via canary to a multi-LoRA pool, with a drift monitor and retrain trigger attached.

**Functional requirements**

- Ingest training data with source provenance; store it as immutable, versioned snapshots.
- Run automated dataset validation (format consistency, exact + near-dedup, train/eval leakage, class balance, DLP scrub of sensitive fields, temporal-split check).
- Launch LoRA/QLoRA SFT jobs (managed or in-house) against a pinned base version; support distillation (teacher-output generation → student SFT).
- Run the eval gate (Module 184) on every candidate: target-task gain on a production-matched held-out set with sliced metrics + floors, general-capability regression, format adherence, contamination check, comparison to the cheaper alternative.
- Register PASS candidates as a pinned, signed `{base version, adapter hash, data snapshot, eval report}` tuple; block deploy without PASS.
- Integrate with the serving platform (Module 182) for canary → progressive rollout with automated rollback.
- Attach a drift monitor and a retrain trigger (scheduled and/or drift-based) to each deployed model.
- Meter and charge back training + teacher-distillation compute per team.
- Front gate: "have you tried prompt engineering / RAG, and what's the measured gap?" — required before a training job is accepted.

**Non-functional requirements**

- Inner-loop iteration (change data → retrain LoRA → eval) under ~1 hour for a small task fine-tune.
- Fail-closed: no eval PASS ⇒ not deployable; missing provenance / failed DLP scrub ⇒ dataset rejected.
- Residency: for flagged workloads, training data never leaves the on-prem region; training runs in-house.
- Auditability: every fine-tune reconstructable to its exact inputs and gate result; SOX change record for regulated-decision models.
- Budget: hard ceiling on training + distillation spend with per-team quotas.

**Back-of-the-envelope estimation**

- 15 teams × ~1 active fine-tune each + ~3 experimental iterations/week ⇒ ~50 training jobs/week. Each LoRA job on an 8B: ~2–6 GPU-hours. ⇒ ~150–300 GPU-hours/week ≈ **a 4–8 GPU pool** covers in-house training comfortably (most jobs can also go to the managed API).
- Distillation: generating 50k teacher completions from a 70B ≈ 50k × ~800 tokens ÷ ~3,000 tok/s ≈ ~4 GPU-hours per dataset, a few times per team per quarter ⇒ modest, bursty.
- Dataset validation: 100k–1M examples per dataset; dedup/leakage/embedding checks ≈ minutes to low tens of minutes on a Spark/Ray job — the pipeline, not GPUs, is the throughput concern.
- Eval-gate runs: ~50/week, each a few hundred to a few thousand eval examples through a model ⇒ small inference load, but it's on the critical path so latency matters more than volume.
- Storage: dataset snapshots (versioned, immutable) — say 50 datasets × ~1–5 GB × ~10 versions ≈ low TBs; adapters are tiny (tens of MB each).

**What the numbers tell you the hard problem is.** Training compute is *small* — 15 teams doing LoRA fine-tunes is a handful of GPUs, and the managed API absorbs most of it. There is no training-scale problem. The hard problems are: (1) **dataset governance** — provenance, versioning, validation, DLP, and the temporal/leakage/balance checks are where quality and compliance live, and they must be *enforced* not advisory, because 15 non-specialist teams will otherwise ship §4-style skewed-eval models; (2) **the eval gate as a hard, standardised gate** — the platform's whole value is that no model reaches production without a production-matched, sliced, regression-checked eval PASS; (3) **the retrain loop and drift** — a fine-tune is not done at launch, and 15 of them each drifting needs orchestrated monitoring and retraining, not manual attention. It's a governance-and-data platform with a small compute annex.

### Step 2 — Propose a high-level design and get buy-in

**Component glossary**

- **Intake Gate** — accepts a fine-tune request only with: a problem justification (cheaper levers tried, measured gap, target metric), a data source declaration with provenance, and a workload risk tier. Rejects "fine-tune on our docs for knowledge" with a pointer to RAG.
- **Dataset Registry** — immutable, versioned dataset snapshots with provenance metadata, lineage, and access control. Every training/eval run references a snapshot hash.
- **Dataset Validator** — batch job: format-consistency, exact + near-dedup (MinHash-LSH), train↔eval leakage, class-balance report, DLP scrub of sensitive fields, temporal-split verification. Emits a report; blocking findings stop the pipeline.
- **Training Orchestrator** — routes a job to the managed FT API or the in-house LoRA/QLoRA runner (by residency tier); pins the base model version; runs a small hyperparameter sweep with early stopping; produces adapter artefacts. For distillation: a teacher-generation step first (batched inference on the teacher, with output-quality filtering), then student SFT.
- **Eval Gate** (Module 184 client) — runs the standardised eval battery on each candidate against the current deployed model as baseline; produces sliced metrics with floors, regression results, contamination check; PASS/FAIL + report + named approver.
- **Model Registry** — pinned, signed `{base version, adapter hash, data snapshot hash, eval report id, approver}` tuples; the authority on what is deployable.
- **Rollout Controller** — drives canary → progressive rollout on the serving platform (Module 182 multi-LoRA pool), with automated rollback on metric regression; keeps the prior tuple deployable.
- **Drift Monitor & Retrain Trigger** — per deployed model: input-distribution distance vs the training snapshot, human-agreement rate on reviewed outputs (blind-labelled slice), confidence-distribution shift, format-adherence trend; fires a retrain (or an investigation) on threshold breach or schedule.
- **Cost Meter** — per-team training + teacher-distillation GPU spend, quotas, chargeback.

**Architecture diagram** — see §3 (the training & release pipeline).

**End-to-end walkthrough — a team fine-tunes a classifier**

1. Team submits to the **Intake Gate**: "prompted 70B works but costs too much; want an 8B fine-tune; target = match 70B per-class recall within 1pt, floors on classes 7 and 8; data = 5 years of analyst-labelled items." Gate checks the justification and risk tier (regulated decision ⇒ high tier), accepts.
2. Data is registered as **snapshot v1** with provenance (source system, extraction date, label origin).
3. **Dataset Validator** runs: flags the class skew (class 8 = 0.6%), flags that examples span a 2023 rubric change, flags no temporal split. Blocking: the pipeline stops with a report.
4. Team addresses it: temporal split (train ≤ 2024-Q2, eval = 2025), rare-class over-sampling for the eval set pulled from a longer history and **re-labelled to the current rubric** by domain experts (blind), class-weighted loss for training. Registered as **snapshot v2**; validator passes with warnings acknowledged.
5. **Training Orchestrator**: residency tier is on-prem ⇒ in-house QLoRA runner, base `llama3-8b@2026-06` pinned, small sweep on `r ∈ {8,16,32}`, early stop on the 2025 held-out set. Produces `adapter-hash-abc`.
6. **Eval Gate**: runs per-class precision/recall on the hand-audited 2025 set vs the 70B baseline; general-capability regression (instruction-following, JSON envelope, refusal); contamination check. Class 8 recall = 0.61, floor = 0.85 ⇒ **FAIL**. Report to the team.
7. Team adds reviewed synthetic class-8 examples (70B-generated, analyst-checked), retrains ⇒ `adapter-hash-def`; class 8 recall = 0.88 ⇒ **PASS**, approver named.
8. **Model Registry**: `{llama3-8b@2026-06, adapter-hash-def, snapshot-v3, eval-report-77, approver}` pinned and signed.
9. **Rollout Controller**: canary 5% on the multi-LoRA pool (Module 182), compare live per-class agreement vs the 70B on shadowed traffic, then 25% → 100%; the 70B stays as the confidence-routed fallback and the rollback target.
10. **Drift Monitor** attached: input-distribution distance, blind-labelled human-agreement per class, quarterly scheduled re-eval on a refreshed 2026 set. A breach fires a retrain via steps 4–9.

**REST API (platform)**

`POST /v1/finetune/requests`
| Field | Type | Description |
|---|---|---|
| `workload` | string | Name / owning team |
| `justification` | object | `{cheaper_levers_tried[], measured_gap, target_metric}` — required |
| `risk_tier` | enum | `low` \| `medium` \| `high` (regulated decision) |
| `data_source` | object | `{system, extraction_query, label_origin, provenance_notes}` |
| `base_model` | string | Pinned base version |
| `method` | enum | `sft-lora` \| `sft-qlora` \| `distill` (+ `teacher_model`) |

`POST /v1/datasets` → returns `{snapshot_id, sha256}`; `GET /v1/datasets/{id}/validation` → the validator report.
`POST /v1/finetune/jobs` — `{request_id, dataset_snapshot_id, hparams}`; returns `job_id`.
`GET /v1/finetune/jobs/{id}` → `{state, adapter_hash?, eval_report_id?}`.
`POST /v1/registry/models` — `{base_version, adapter_hash, dataset_snapshot_id, eval_report_id, approver}` → `409` unless the eval report is PASS.
`POST /v1/rollout` — `{model_tuple_id, strategy: canary→progressive, rollback_metric}`.

**Data model**

`dataset_snapshot`
| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `sha256` | text | Content hash (immutable) |
| `provenance` | jsonb | source system, extraction query, label origin, rubric version(s) present |
| `validation_state` | text | `PENDING → PASS \| BLOCKED` |
| `validation_report_uri` | text | dedup/leakage/balance/DLP findings |
| `created_by` / `created_at` | text / timestamptz | |

`finetune_job`
| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `request_id` | uuid FK | Links to the intake justification + risk tier |
| `dataset_snapshot_id` | uuid FK | |
| `base_version` | text | Pinned |
| `method` | text | `sft-lora` \| `sft-qlora` \| `distill` |
| `teacher_model` | text | For distillation; null otherwise |
| `adapter_sha256` | text | Output artefact |
| `state` | text | `QUEUED → RUNNING → EVAL → PASS \| FAIL \| ERROR` |

`registered_model` (the pinned tuple)
| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `base_version` | text | |
| `adapter_sha256` | text | |
| `dataset_snapshot_id` | uuid FK | |
| `eval_report_id` | uuid FK | Must be PASS |
| `approver` | text | Named human (SOX) |
| `signature` | text | Supply-chain signature |
| `state` | text | `REGISTERED → CANARY → DEPLOYED → RETIRED` |

`drift_monitor`
| Column | Type | Description |
|---|---|---|
| `registered_model_id` | uuid FK | |
| `input_distance` | float | vs training snapshot, rolling |
| `human_agreement_by_class` | jsonb | blind-labelled slice, per class |
| `last_reeval_report_id` | uuid | refreshed held-out set |
| `retrain_state` | text | `HEALTHY → TRIGGERED → IN_PROGRESS` |

**Status lifecycles**

- Dataset: `PENDING → PASS → (referenced) → ARCHIVED` or `PENDING → BLOCKED`.
- Job: `QUEUED → RUNNING → EVAL → PASS | FAIL | ERROR`.
- Registered model: `REGISTERED → CANARY → DEPLOYED → RETIRED` (rollback = re-`DEPLOYED` the prior tuple).
- Drift: `HEALTHY → TRIGGERED → IN_PROGRESS → HEALTHY`.

**Modelling rationale (inline).** `dataset_snapshot` is **immutable and content-hashed** because "which exact data produced this model" is an audit question and a reproducibility anchor — a mutable dataset makes every downstream claim unverifiable. `validation_state` is a **column, not a separate check** so a `BLOCKED` dataset is structurally unusable by a job. `registered_model` stores the **four-part tuple with the approver**, because all four must line up (§14) and SOX needs the named human. `finetune_job` records `base_version` and `teacher_model` explicitly — a later base update or a teacher-terms question needs to be answerable without spelunking. `drift_monitor` keeps `human_agreement_by_class` from a **blind-labelled slice**, not from model-influenced labels, because a model evaluated on labels it shaped converges to self-agreement (§E3).

### Step 3 — Design deep dive

**The Intake Gate as the cheapest control.** Most bad fine-tunes are prevented here: the request must state which cheaper levers were tried and the *measured* residual gap. "Fine-tune on our 50k policy docs so it knows the policies" is rejected with a RAG pointer (§A2). This gate costs a form and a reviewer and prevents the most expensive class of mistake — a months-long fine-tune project for a problem RAG solves in a week.

**Dataset validation is blocking, not advisory.** The validator's findings — class skew below a floor, rubric-change span with no temporal split, train↔eval near-duplicates, DLP hits, format inconsistency — set `validation_state = BLOCKED`, and a `BLOCKED` snapshot cannot be attached to a job. This is what stops 15 non-specialist teams from each independently shipping the §4 model. The class-balance report and the temporal-split requirement are the two highest-value checks.

**The eval gate is standardised and owned by the platform, not the team.** The team supplies the held-out set (built to the platform's standard: production-matched, rare-class over-sampled, hand-audited, temporally split, isolated), but the *battery* — sliced per-class metrics with floors, general-capability regression suite, format adherence, contamination check, comparison to the cheaper alternative — is fixed and run by the platform. A team cannot lower a floor or skip the regression suite. FAIL produces a report and blocks registration.

**Distillation flow and the terms check.** For `method = distill`, the orchestrator first runs teacher generation (batched inference on `teacher_model` over the input set, with an output-quality filter dropping low-confidence/malformed teacher outputs), then student SFT on the filtered pairs. If `teacher_model` is a hosted commercial model, the intake gate requires a legal-review artefact confirming its terms permit training from its outputs (§A10) — no artefact, no job.

**Base-version pinning propagates to serving.** The registered tuple pins the base version; the multi-LoRA router (Expert exercise) refuses to serve an adapter whose `base_version` ≠ the pool's current base, falling back to the base model and incrementing a counter. So a provider base update that goes out without re-training adapters degrades *visibly* (fallback rate spikes with `reason=version mismatch`) rather than silently (§14, §I6).

**Retrain loop and the feedback-loop guard.** Each deployed model has a drift monitor. Retrain trigger sources: scheduled (e.g. quarterly), input-distribution distance breach, or human-agreement decline on the **blind-labelled slice** (never on model-influenced labels — §E3). A triggered retrain re-runs the pipeline from dataset refresh (new snapshot, re-validated) through the eval gate and canary rollout. Label provenance is tracked per training example (`human-blind` / `human-corrected-from-model` / `model-accepted`) and the model-influenced fraction is capped for consequential classes.

**Residency routing.** The intake `risk_tier` and a data-classification tag decide whether a job goes to the managed FT API (data leaves the region) or the in-house QLoRA runner (data stays). Flagged workloads are hard-routed in-house; the orchestrator refuses to send their data to the managed API.

**Consistency.** The model registry and dataset registry are **CP** — deploying an unvalidated dataset or a non-PASS tuple is worse than a slow deploy, so both are strongly consistent and authoritative. Training jobs and drift monitoring are batch/async and tolerate delay. The eval gate is on the critical path but its result is a durable, referenced artefact.

**Failure handling.** Job failure ⇒ `ERROR` state, no artefact registered, team notified. Eval gate unavailable ⇒ registration blocks (fail-closed), deployed models unaffected. Canary regression ⇒ automated rollback to the prior tuple, page. Dataset validator finds a DLP hit post-registration (rule update) ⇒ the snapshot and any models derived from it are flagged for review. Managed FT API outage ⇒ jobs queue or route to the in-house runner if residency permits.

### Step 4 — Wrap-up

**Not covered, and the next questions:**
- Preference tuning (DPO) pipeline and preference-data collection from review logs — deferred to v2.
- Continued pretraining infrastructure for a genuine domain-distribution gap.
- The eval framework internals — dataset curation tooling, LLM-as-judge, statistical significance (Module 184).
- Automated red-teaming of fine-tuned models for memorisation and injected-behaviour backdoors.
- Cross-region training data federation for multi-domicile workloads.
- A model-catalogue UX for teams to discover existing fine-tunes before building a new one.
- Chargeback pricing and how experimental iterations are funded vs production retrains.

**Summary.** An intake gate that stops unnecessary fine-tunes, an immutable content-hashed dataset registry with a *blocking* validator (balance, temporal split, leakage, DLP), a training orchestrator that pins the base version and routes by residency, a platform-owned standardised eval gate that no team can weaken, a signed four-part model-registry tuple with a named approver, reversible canary rollout onto the multi-LoRA serving pool, and a drift-monitored retrain loop that labels blind to avoid a self-agreement feedback loop. Training compute is small; the platform's value is that a fine-tune's quality and compliance are *enforced properties* of a governed pipeline, not the discipline of whichever team built it.

### References

1. Hu et al., *LoRA: Low-Rank Adaptation of Large Language Models*, ICLR 2022.
2. Dettmers et al., *QLoRA: Efficient Finetuning of Quantized LLMs*, NeurIPS 2023.
3. Houlsby et al., *Parameter-Efficient Transfer Learning for NLP* (adapters), ICML 2019; Li & Liang, *Prefix-Tuning*, 2021.
4. Ouyang et al., *Training language models to follow instructions with human feedback* (InstructGPT / RLHF), 2022.
5. Rafailov et al., *Direct Preference Optimization*, NeurIPS 2023; Hong et al., *ORPO*, 2024; Ethayarajh et al., *KTO*, 2024.
6. Hinton et al., *Distilling the Knowledge in a Neural Network*, 2015; Kim & Rush, *Sequence-Level Knowledge Distillation*, 2016.
7. Gururangan et al., *Don't Stop Pretraining: Domain-Adaptive Pretraining*, ACL 2020.
8. Carlini et al., *Extracting Training Data from Large Language Models*, USENIX Security 2021; *Quantifying Memorization Across Neural Language Models*, 2023.
9. Sheng et al., *S-LoRA: Serving Thousands of Concurrent LoRA Adapters*, 2023; vLLM multi-LoRA documentation.
10. Zhou et al., *LIMA: Less Is More for Alignment* (data quality over quantity in SFT), 2023.
11. Shumailov et al., *The Curse of Recursion / model collapse from training on generated data*, 2023 (the §E3 feedback loop).
12. *System Design Interview Vol. 2*, Alex Xu & Sahn Lam — payment-system chapter (four-step structure).
13. Module 164 (RAG — the knowledge lever), Module 182 (Serving — multi-LoRA, the small-model-as-workhorse recommendation), Module 184 (Evaluation — the gate), Module 163 §4 (few-shot distribution bias) — this course.

---

## 13. Low-Level Design

**Requirements.** Accept a governed fine-tune request; validate and version data; run LoRA/QLoRA or distillation against a pinned base; gate on a standardised eval; register a signed four-part tuple; roll out reversibly; monitor drift and retrain.

**Class diagram (textual)**

```
IntakeGate
 ├─ accept(request) -> Accepted | Rejected(reason)   # requires justification + risk tier; blocks "FT for knowledge"
 └─ requiresLegalReview(method, teacher_model) -> bool

DatasetRegistry
 ├─ put(rawData, provenance) -> Snapshot(sha256)     # immutable
 ├─ validator: DatasetValidator
 └─ deployable(snapshotId) -> bool                   # false if BLOCKED

DatasetValidator                                     # Medium + Hard exercises
 ├─ formatConsistency / dedup / leakage / classBalance / dlpScrub / temporalSplitCheck
 └─ report() -> {findings, blocking: bool}

TrainingOrchestrator
 ├─ route(job) -> ManagedFtClient | InHouseLoraRunner   # by residency tier
 ├─ pinBase(version)
 ├─ distill: TeacherGenerator (+ output-quality filter) then studentSFT
 └─ run(job) -> Adapter(sha256)

EvalGateClient  ── Module 184
 └─ evaluate(candidate, baseline) -> Report(PASS|FAIL, slicedMetrics, regressions, contamination)

ModelRegistry
 ├─ register({baseVersion, adapterSha, datasetSnapshotId, evalReportId, approver}) -> requires PASS
 └─ deployable(tupleId) -> bool

RolloutController
 ├─ canaryThenProgressive(tupleId, rollbackMetric)
 └─ rollback() -> prior tuple

DriftMonitor
 ├─ inputDistance() / humanAgreementByClass(blindSlice) / reeval(refreshedSet)
 └─ maybeTriggerRetrain()

MultiLoraRouter                                      # Expert exercise
 └─ route(tenant) -> MERGED_POOL | MULTI_LORA | BASE_FALLBACK   (FAIL / base-mismatch => unroutable)
```

**Sequence diagram** — see the §12 walkthrough.

**Design patterns used.** Gateway/Facade (IntakeGate, platform API); Strategy (managed vs in-house training route; SFT vs distillation; rollout strategy); Chain of Responsibility (validator checks; eval-gate battery); Template Method (training job: fixed stages, pluggable method); Observer (DriftMonitor on production feedback); Memento/Snapshot (immutable dataset versions); Circuit Breaker (canary rollback; MultiLoraRouter fallback).

**SOLID mapping.** *SRP* — intake, validation, training, eval, registry, rollout, drift each isolated. *OCP* — a new adaptation method (DPO) or a new validator check is added without touching the orchestrator core. *LSP* — managed and in-house training runners are interchangeable behind `TrainingRunner`; SFT and distillation behind `AdaptationMethod`. *DIP* — the platform depends on an `EvalGate` abstraction (Module 184) and a `ServingPlatform` abstraction (Module 182), reusing them rather than reimplementing eval or serving.

**Extensibility.** Adding DPO = a new `AdaptationMethod` + a preference-dataset validator + a preference metric in the eval battery; no change elsewhere. A new residency region = a routing rule + an in-house runner deployment. A model catalogue for discovery = a read view over `registered_model`.

**Concurrency / thread safety.** Dataset snapshots are immutable, so concurrent readers need no locking; the content hash makes writes idempotent. Training jobs are independent and queued; the orchestrator uses a per-team quota semaphore for the in-house pool. Registry writes take a per-`{base,workload}` lock so two candidates can't both claim `DEPLOYED`. The MultiLoraRouter's hot-adapter LRU is lock-guarded per pool. Drift-monitor evaluations are scheduled, single-flighted per model.

---

## 14. Production Debugging

**Incident.** A fine-tuned house-style summarisation model (LoRA adapter on a hosted 8B base, served via the managed endpoint) starts producing summaries that are subtly *off-style* — slightly more verbose, occasionally breaking the "no first person" house rule it had followed perfectly for months. No deploy, no adapter change, no data change. The drift monitor's input-distance metric is flat (inputs haven't changed). Aggregate ROUGE against reference summaries is down only ~1.5 points — within the noise band the team had set, so no alert fired.

**Root cause.** The managed provider had rolled out a minor version bump of the 8B base model — same model ID, same endpoint, a "quality improvement" release — without changing the version string the team had recorded. The LoRA adapter was trained against the *previous* base's activations; applied to the new base, the style-shaping transform was slightly miscalibrated, so the house-style behaviour degraded. This is Module 162 §14 ("pinned isn't as pinned as it sounds") landing precisely at the adapter/base seam that Module 183 §I6 flagged — the pinning discipline covered the *adapter* and the *data* but the *base* was pinned only by a string the provider silently redefined.

**Investigation.**
- The team diffed recent outputs against outputs from three months prior on a fixed probe set — the style regression was real and consistent from a specific date.
- That date matched an entry in the provider's model changelog: "8b-base: serving improvements, no API change."
- Re-running the eval gate with the adapter on the current base reproduced the style regression on the sliced style-adherence metric (first-person-violation rate up 4×) — which the launch eval *had* measured, but the production monitor did not track (it tracked aggregate ROUGE, which barely moved).
- The `{base version, adapter hash, data snapshot, eval report}` tuple in the registry recorded `base = 8b-base` with no immutable base fingerprint — just the mutable name.

**Fix.**
1. **Immediate**: pin to a versioned/dated base snapshot the provider does offer (`8b-base@2026-05-15`), which restores the prior behaviour, and re-run the eval gate to confirm.
2. **Registry**: record an **immutable base fingerprint** (a hash of a fixed probe-response set, or the provider's dated snapshot ID) in the tuple, not just the name; a change in the fingerprint invalidates the tuple and blocks serving.
3. **Production monitor**: add the **sliced style-adherence metrics** (first-person-violation rate, length distribution) that the launch eval used to the drift monitor — the aggregate ROUGE band was too coarse to catch a style regression, exactly the §4 "aggregate hides a concentrated failure" shape.
4. **Base-drift canary**: a scheduled job that runs the fixed probe set through the current base (no adapter) and alerts on output drift, catching a silent provider update within a day.
5. **Retrain against the new base** as the forward plan (the dated snapshot won't be supported forever), gated by the full eval.
6. Raised with the provider: request advance notice and stable dated snapshots for fine-tune bases.

**Prevention.**
- **A fine-tune's release tuple must pin the base by an immutable fingerprint, not a mutable name** — the pinning discipline has to reach the base, not stop at the adapter.
- **Production monitoring must track the *sliced* metrics the launch eval used**, not a coarser aggregate — a style regression, a rare-class recall drop, or a format-adherence decline can hide inside a barely-moved aggregate (the recurring "aggregate cannot detect a concentrated failure" pattern).
- **A hosted base is a dependency that can change under you silently** — a base-drift canary is the detection, a dated snapshot is the short-term control, retraining is the resolution.
- Same shape as §4: the pipeline was built correctly; it broke on a seam (base pinning) and a monitoring granularity (aggregate vs sliced) that the launch process didn't carry into production.

---

## 15. Architecture Decision

**Decision.** For a high-volume house-style generation workload (e.g. drafting suitability rationales in a fixed firm format, ~2M requests/day), how should the model be adapted: (A) prompt engineering on a frontier hosted model, (B) RAG for the firm's style guide + frontier model, (C) SFT (LoRA) a mid-size model on house-style examples, (D) distil a frontier model into a small SFT'd model?

**Option A — Prompt engineering on a frontier model.**
*Advantages:* zero training/eval/retrain infra; instantly benefits from model upgrades; no forgetting or data-in-weights risk; fastest to ship.
*Disadvantages:* at 2M/day the per-token cost of a frontier model is a large recurring bill; style adherence from a prompt is good but not rock-solid at that volume (occasional format/tone slips); latency is the frontier model's; full dependence on one vendor's price/availability.
*Cost:* high recurring opex, ~zero capex. *Risk:* low technical, high cost-exposure.

**Option B — RAG (style guide) + frontier model.**
*Advantages:* the style guide is retrievable and updatable; grounds the model in the current rules.
*Disadvantages:* style is *behaviour*, not knowledge — stuffing the style guide into context helps marginally over a good prompt, adds tokens (more cost), and still doesn't give reliable adherence; this is using the knowledge lever for a behaviour problem.
*Cost:* high opex (even more tokens than A). *Risk:* low, but it's the wrong lever — minimal benefit over A.

**Option C — SFT (LoRA) a mid-size model on house-style examples (recommended).**
*Advantages:* house style is exactly what SFT is for — a few thousand `(input, on-style rationale)` pairs teach the format and tone reliably; a mid-size model at 2M/day is far cheaper per token than a frontier model and lower latency; reduces vendor lock-in (can run open-weight); the style behaviour is baked in, not re-prompted every call.
*Disadvantages:* training + eval + retrain-loop infrastructure and lead time; catastrophic-forgetting risk (mitigated by including the full output format in every example and a regression suite); needs a drift monitor as the style guide evolves; the fine-tune must be re-validated on base updates (§14).
*Cost:* medium capex (curation + eval + retrain loop), much lower opex than A/B. *Risk:* medium, concentrated in eval-set quality and the retrain loop — both governable.

**Option D — Distil a frontier model into a small SFT'd model.**
*Advantages:* all of C's serving economics, and the training data can be frontier-generated (frontier drafts the on-style rationale, humans lightly review) so curation is faster; good when you lack enough human-written examples.
*Disadvantages:* C's disadvantages plus a teacher-generation cost and the provider-terms question (can you train from the frontier model's outputs? — §A10); the student inherits the teacher's style *quirks*, so human review of the teacher data matters.
*Cost:* medium capex (teacher generation + curation + eval), low opex. *Risk:* medium + a legal/ToS gate.

**Recommendation — Option C, using Option D's teacher-generation to bootstrap the dataset if human-written examples are thin, subject to the ToS check.**
House style is a behaviour problem at a volume where frontier-model per-token cost is the dominant concern, which is the textbook case for a fine-tuned mid-size model. Option A is the right *interim* answer — ship it on a frontier model with a strong prompt while the fine-tune dataset and eval set are built, then switch. Option B is the wrong lever and adds cost for little gain. Whether to seed the dataset via distillation (D) depends only on how many good human-written examples exist and whether the teacher's terms permit it. The decision gates on the fine-tune's style-adherence eval (sliced: format-valid rate, tone, the specific house rules) clearing a floor against the frontier baseline, and on the projected tokens/$/latency win being real at 2M/day — both measurable before committing.

---

## 17. Principal Engineer Perspective

**Business impact.** Model adaptation is where a team either builds a durable cost/quality advantage — a small model that does a narrow job as well as a frontier model at a fraction of the cost (Module 182 §15) — or sinks months into a fine-tune for a problem RAG would have solved in a week. The Principal's first job is the *lever decision*: knowledge → RAG, behaviour → adaptation, and don't confuse them.

**Engineering trade-offs.** Every adaptation choice is a trade: prompt (cheap, weak guarantees, benefits from upgrades) vs RAG (current, auditable, knowledge only) vs LoRA (behaviour, cheap serving, forgetting risk, retrain loop) vs full FT (max shift, worst forgetting, hardest to serve as variants) vs continued pretraining (real capability, months and serious money). None is a default; each is a measured decision with a named cost and a named alternative it must beat.

**Technical leadership.** The recurring failure shape here is a headline metric that is true about the wrong population: 96% validation accuracy on a random split of a skewed, time-mixed pool (§4); aggregate ROUGE hiding a style regression (§14). A Principal institutionalises the counter — eval sets *constructed* to reflect production, over-sampled on the rare-critical cases, hand-audited to the current rubric, split by time; sign-off on *sliced* metrics with floors on what carries the consequence; and general-capability regression testing so an additive-in-intent change isn't subtractive in effect.

**Cross-team communication.** A fine-tuning platform serves non-specialist teams who will, left alone, ship §4 models. The controls are an intake gate that forces the "did you try RAG" question, a *blocking* dataset validator, and a platform-owned standardised eval gate that a team cannot weaken. The Principal runs the forum where the eval-set standard, the retrain triggers, and the build-vs-buy line for training are set and taught.

**Architecture governance.** Standing governed artefacts: the intake-gate criteria, the dataset-validation ruleset (balance floors, temporal-split requirement, leakage/DLP checks), the standardised eval battery and its floors, the four-part pinned-tuple registry format, and the retrain-trigger policy — reviewed jointly by the platform team and model risk / security.

**Cost optimisation.** The adaptation itself is a cost lever — a fine-tuned small model as the workhorse is often the single biggest inference-cost reduction available (Module 182 §E5). But it has a fixed cost (curation + eval + retrain loop) that only amortises above a real, sustained volume, so the Principal insists on the volume-and-stability case before committing, and on prompt-on-frontier as the interim. Training and teacher-distillation spend get the same per-team metering and chargeback as inference.

**Risk analysis.** The dominant risks: the wrong lever (fine-tuning for knowledge — closed by the intake gate); inherited eval skew (closed by constructed, sliced, time-split eval sets with floors); catastrophic forgetting (closed by regression suites and format-in-every-example); data baked irreversibly into weights (closed by keeping sensitive/deletable data in RAG, not training); a silent base update against a stale adapter (closed by immutable base fingerprints and a base-drift canary); a self-agreement feedback loop from retraining on model-influenced labels (closed by blind labelling and label provenance); and a ToS violation from distilling a hosted model (closed by a legal gate). Most are data-quality, evaluation, and governance risks — not modelling risks.

**Long-term maintainability.** A fine-tune is not done at launch — the world it was tuned on moves (input distribution, labelling rubric, the base model under it, the house style itself). It stays fit only if a drift monitor trends the right *sliced* signals (input distance, blind-labelled human agreement per class, format adherence, confidence shift), a defined trigger fires a governed retrain, and the eval set is itself refreshed on a cadence — the same "verify the verifier, detect by trend and by slice, never trust a stale aggregate" discipline this course applies everywhere, here pointed at a model whose quality lives in data and evaluation rather than in the artefact.

---

**Next in this run:** Module 184 — AI Evaluation & Continuous Assurance: LLM-as-Judge, Eval Harnesses, CI Regression Gates & Online Experimentation, which is the "eval gate" this module and Module 182 both depend on, made into its own discipline.
