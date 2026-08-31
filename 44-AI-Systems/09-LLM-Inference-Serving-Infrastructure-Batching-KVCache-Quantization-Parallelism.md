# Module 182 — LLM Inference & Serving Infrastructure at Scale: Batching, KV Cache, Quantization, Parallelism & the Model Gateway

> Domain: AI Systems (merged 44-50) | Level: Beginner → Expert | Prerequisite: [[../44-AI-Systems/01-AI-Systems-LLM-Fundamentals-Transformers-Tokenization-Inference]], [[../44-AI-Systems/04-LLM-Integration-ProductionAPIPatterns-Streaming-FunctionCalling-Caching-Resilience]], [[../29-Performance-Engineering/01-Performance-Engineering-Fundamentals]], [[../14-System-Design/16-Interview-Execution-Playbook-Estimation-Rubric]]

>
> **Scope note:** Ninth module of the merged `44-AI-Systems` domain, first of a four-module gap-fill (182–185) closing the folder's coverage of the *infrastructure and lifecycle* beneath the LLM application layer that Modules 162–168 and 181 built. Module 162 established inference *characteristics* — prefill/decode phases, KV cache, the cost of context length — as inherited properties an application must live with. This module is the other side of that coin: how you actually *serve* a model efficiently, what a self-hosted inference platform looks like, and the decisions (quantization, parallelism, batching strategy, autoscaling) a Principal owns when "just call the API" stops being the answer — because of cost at volume, data residency, latency floors, or a fine-tuned model (Module 183) that has no hosted endpoint. §12 follows the four-step Pragmatic Engineer System Design spine per the 2026-08-09 standard.

---

## 1. Fundamentals

**What.** LLM inference serving is the system that turns a stream of prompt requests into token streams, on a fixed pool of expensive accelerators (GPUs/TPUs), while meeting latency SLOs and maximising the tokens-per-dollar you extract from the hardware. The serving stack has layers:

```
client → model gateway (auth, routing, rate limit, semantic cache, fallback, metrics)
       → inference server (vLLM / TGI / TensorRT-LLM / SGLang): scheduler + batching + KV cache manager
       → model runtime (CUDA kernels, attention impl, quantized GEMMs)
       → accelerator pool (GPUs, interconnect: NVLink / PCIe / InfiniBand)
```

**Why it matters for a Principal.** A single H100 is ~$2–4/hour. A 70B model at FP16 needs ~140 GB just for weights — two to four such GPUs before a single request runs. The gap between a naive deployment and a tuned one is routinely **5–20× in throughput** at the same latency, which is the difference between a $200k/year and a $3M/year platform for the same workload. The Principal decisions — self-host vs API, which quantization, tensor vs pipeline parallel, continuous batching config, how to autoscale something with a 3–5 minute cold start — are all cost/latency/quality trade-offs with no default answer, and getting them wrong is expensive in a way that compounds monthly.

**When you self-host instead of calling a hosted API.** Any one of: (1) **volume economics** — past roughly hundreds of millions to billions of tokens/day, amortised self-hosting can undercut per-token API pricing, *if* utilisation is high; (2) **data residency / isolation** — inference must run in a specific region or VPC with no third-party egress (Module 181 §2.3); (3) **latency floor** — you need a TTFT the hosted provider's queue can't guarantee; (4) **a custom model** — a fine-tune, a distilled model, or an open-weight model with no commercial endpoint (Module 183); (5) **predictable capacity** — you cannot tolerate a shared provider's rate limits or capacity crunches during a market event. Otherwise, a hosted API is almost always the right call — you are not in the GPU-operations business for fun.

**How — the two phases that define everything.** Every inference request has:

- **Prefill** (a.k.a. prompt processing): the model processes all N input tokens in one forward pass, building the KV cache. This is **compute-bound** — a big matrix multiply — and its cost scales with input length. It produces the first output token. Latency here = **TTFT (time to first token)**.
- **Decode** (generation): the model produces output tokens one at a time, each pass reading the *entire* KV cache and all weights from GPU memory to compute one token. This is **memory-bandwidth-bound**, not compute-bound — the GPU's ALUs are mostly idle waiting for memory. Latency per token = **TPOT / ITL (time per output token / inter-token latency)**; total decode time ≈ output_tokens × TPOT.

The two phases have *opposite* resource profiles, and almost every serving optimisation is about exploiting that: batch aggressively to fill the idle compute during decode, page the KV cache so you can fit more concurrent requests, quantize to cut the memory traffic decode is bottlenecked on.

---

## 2. Deep Dive

### 2.1 Why decode is memory-bandwidth-bound, and why that dictates batching

Arithmetic intensity = FLOPs performed per byte read from memory. A decode step for one request does ~2·P FLOPs (P = parameter count) and reads ~2·P bytes (FP16 weights) plus the KV cache. Intensity ≈ 1 FLOP/byte. A modern GPU wants intensity in the hundreds to saturate its compute. So at batch size 1, decode uses a few percent of the GPU's FLOPs — you are paying for a Ferrari to sit in traffic.

**The fix is batching**: if 64 requests decode together, the weights are read once and reused across all 64, so intensity rises ~64× and the GPU actually works. This is why throughput scales almost linearly with batch size in the decode-bound regime until you hit a memory limit — and why the entire game is *getting batch size up without blowing out latency or memory*.

Prefill is already compute-bound at batch 1 (it's a large GEMM over N tokens), so batching helps it less and can even hurt interactive latency by making prefill passes longer.

### 2.2 KV cache — the real memory constraint

For each token kept in context, every layer stores a key and value vector per attention head. Size:

```
kv_bytes = 2 (K and V) × n_layers × n_kv_heads × d_head × dtype_bytes   ... per token
total    = kv_bytes × sequence_length × batch_size
```

Worked example, Llama-3-70B-class (80 layers, 8 KV heads with GQA, d_head 128, FP16):
`2 × 80 × 8 × 128 × 2 = 327,680 bytes ≈ 320 KB per token`.
At 8k context: `320 KB × 8192 ≈ 2.6 GB per request`. On an 80 GB GPU with ~140 GB of weights across 2 GPUs (so ~10 GB free per GPU after overhead), you fit only a handful of long-context requests. **The KV cache, not the weights, is what caps your batch size** — and long-context requests are disproportionately expensive because their cache is linear in length.

Mitigations: **GQA/MQA** (fewer KV heads — already in the model architecture), **KV cache quantization** (store K/V in INT8/FP8 — ~2× more requests, small quality cost), **paging** (§2.4), **eviction / sliding window** for very long contexts, and **prefix caching** (§2.4) to avoid recomputing shared prefixes.

### 2.3 Continuous (iteration-level) batching vs static batching

**Static batching**: collect N requests, run them together until *all* finish, then take the next batch. Catastrophic for LLMs because output lengths vary 10–100×: a batch of 32 where 31 requests want 20 tokens and one wants 2000 keeps 31 GPU slots idle for the entire long generation. Utilisation collapses.

**Continuous batching** (a.k.a. in-flight / iteration-level batching — vLLM, TGI, TensorRT-LLM): the scheduler operates at the granularity of a single decode step. After every step, finished requests leave the batch and waiting requests join. A request that wants 2000 tokens simply stays in the batch for 2000 steps while hundreds of short requests flow through the other slots. This is the single biggest throughput win in modern serving — typically **2–4× over static batching** — and it's why you use a purpose-built inference server rather than a naive `model.generate()` loop.

Scheduling knobs: `max_num_seqs` (batch-size ceiling), `max_num_batched_tokens` (per-step token budget, bounds prefill cost), and a policy for interleaving prefill of new requests with decode of running ones (**chunked prefill** splits a long prompt's prefill across several steps so it doesn't stall decode for everyone).

### 2.4 PagedAttention and prefix caching

**PagedAttention** (vLLM): the KV cache is stored in fixed-size **blocks** (like OS pages) rather than one contiguous per-request buffer. Benefits: near-zero fragmentation (you were previously reserving `max_seq_len` per request and wasting most of it), and **copy-on-write sharing** of blocks between requests with a common prefix.

**Prefix caching** builds on that: if 10,000 requests all start with the same 2,000-token system prompt, its KV blocks are computed once and shared. Prefill cost for the shared part drops to zero on cache hit. Huge for RAG (Module 164 — big retrieved context, stable instructions) and agents (Module 166 — long stable system prompt across turns).

**The scoping hazard** (this course's recurring theme): a shared prefix cache keyed only on *token content* will happily serve one tenant's cached KV blocks to another tenant whose request has an identical prefix. If prompts can contain anything tenant-specific in the prefix, or if the cache key omits a tenant/security dimension, this is a cross-tenant information path — the same class as Module 158's `trackBy`, Module 160's React Query keys, and Module 165's semantic cache. Prefix-cache keys must include the tenant/isolation dimension, or prefix sharing must be scoped within a tenant only. §11 Hard exercise builds this.

### 2.5 Quantization

Storing weights and/or activations in fewer bits cuts the memory traffic that decode is bottlenecked on, and lets a model fit on fewer GPUs.

| Scheme | What's quantized | Typical quality cost | Notes |
|---|---|---|---|
| **FP16 / BF16** | baseline (16-bit) | — | Reference |
| **FP8 (E4M3)** | weights + activations | negligible on H100+ | Hardware-accelerated; the current sweet spot where supported |
| **INT8 weight-only** | weights only | very small | GEMMs still run in FP16 after dequant |
| **INT8 W8A8** (SmoothQuant) | weights + activations | small, task-dependent | Needs calibration; activation outliers are the hard part |
| **INT4 weight-only** (GPTQ, AWQ) | weights only | small–moderate; worse on reasoning/code | ~4× weight memory reduction; decode-latency win; prefill less so |
| **KV cache INT8/FP8** | the KV cache | small | Orthogonal to weight quantization; ~2× batch capacity |

Principal guidance: **FP8 or INT8 weight-only is usually free lunch** on modern hardware for most workloads — measure on *your* eval set (Module 184), because the quality hit is task-dependent and reasoning/code/math degrade first. INT4 is for when you must fit a bigger model on smaller hardware and you've verified the accuracy loss is acceptable for the specific task. Never ship a quantization without an eval-set regression check — "it still sounds fluent" is not a quality gate.

### 2.6 Parallelism — splitting a model across GPUs

| Strategy | Split | Communication | When |
|---|---|---|---|
| **Tensor parallel (TP)** | Each layer's weight matrices sharded across GPUs; every GPU does part of every layer | All-reduce **every layer** — needs fast interconnect (NVLink); dies over PCIe/Ethernet | Model doesn't fit on one GPU; latency matters. Keep TP within one node (≤8 GPUs) |
| **Pipeline parallel (PP)** | Whole layers assigned to different GPUs; request flows GPU0→GPU1→… | Point-to-point between stages; tolerates slower links | Model spans multiple nodes; throughput matters more than latency. Introduces **pipeline bubbles** (idle time) unless micro-batched |
| **Expert parallel (EP)** | MoE experts distributed across GPUs | All-to-all to route tokens to their experts | Mixture-of-Experts models specifically |
| **Data parallel (DP) / replicas** | Full model copy per GPU/node; requests load-balanced | None between replicas | Scaling throughput once the model fits; the outer scaling layer |

Realistic large-model deployment: TP=8 within a node (model fits across 8 GPUs with NVLink), then DP replicas of that 8-GPU unit behind a router for throughput. PP only when a single model genuinely won't fit in one node. Every unit of TP adds per-layer communication latency, so don't use more TP than you need to fit the model plus KV cache.

### 2.7 Speculative decoding

A small, cheap **draft model** proposes k tokens; the big **target model** verifies all k in a *single* forward pass (cheap because that pass is one step, not k). Accepted tokens are free; on the first rejection you fall back. If the draft's acceptance rate is high (drafts are "easy" continuations), you get 2–3× fewer target-model steps.

It helps most in the **latency-bound, low-batch** regime (few concurrent requests, GPU compute idle — spend it on verification). At high batch the GPU is already compute-saturated by batching and speculation adds overhead for little gain. Variants: a separate draft model, **Medusa** (extra heads on the target model), **EAGLE**, **lookahead decoding** (no draft model, uses n-gram guesses). Acceptance rate is workload-dependent — measure.

### 2.8 Prefill/decode disaggregation

Because prefill (compute-bound, bursty, long) and decode (bandwidth-bound, steady) contend for the same GPU, newer designs run **separate pools**: a prefill cluster produces KV caches and streams them to a decode cluster over fast interconnect. This removes the "a big prefill stalls everyone's decode" interference, at the cost of a KV-cache transfer and operational complexity. Worth it at large scale with strict interactive TPOT SLOs; overkill for a small internal platform.

---

## 3. Visual Architecture

**Serving stack & request lifecycle**

```
                         ┌───────────────────────────────────────────────┐
  client (stream) ──────►│  MODEL GATEWAY                                 │
                         │  auth · quota · route(model,tenant) ·          │
                         │  semantic cache (165) · prompt DLP (181) ·     │
                         │  fallback policy · OTel metrics                │
                         └───────────────┬───────────────────────────────┘
                                         │ least-outstanding-tokens routing
                     ┌───────────────────┼────────────────────┐
                     ▼                   ▼                    ▼
             ┌──────────────┐    ┌──────────────┐     ┌──────────────┐
             │ replica A     │    │ replica B    │     │ replica C     │   ← DP replicas
             │ (TP=8, NVLink)│    │ (TP=8)       │     │ (TP=8)        │
             │  ┌──────────┐ │    └──────────────┘     └──────────────┘
             │  │scheduler │ │  continuous batching, chunked prefill
             │  │  ├ waiting queue                                     
             │  │  ├ running batch (decode step loop)                  
             │  │  └ KV cache mgr (paged blocks + prefix cache)        
             │  └──────────┘ │
             │  8× GPU        │
             └──────────────┘

  Autoscaler:  watches queue depth + TTFT p99 → adds/removes replicas
               (cold start 3–5 min: image pull + weight load) → WARM POOL
```

**Prefill vs decode timeline for one request (batch view)**

```
GPU step:  1        2      3      4      5      6      7   ...
req R1  : [PREFILL 3k tok....] D  D  D  D  (finishes at step 6)
req R2  :          [PREFILL] D   D   D   D   D   D   ...
req R3  :                    [PF] D  D  D  D  D  ...      ← joins mid-flight (continuous batching)
                    ▲ chunked prefill: R2's long prompt split so it doesn't stall R1's decode
```

---

## 4. Production Example

**Context.** A bank runs an internal **document-extraction** service — pulling structured fields from scanned trade confirmations and KYC documents — on a self-hosted Llama-3-70B-class model, chosen over a hosted API for data-residency (documents contain client PII that must not leave the on-prem region). Deployment: 3 replicas, each TP=8 on one DGX node, vLLM with continuous batching, behind a gateway. Two traffic classes share it: **interactive** (an analyst opens a document, expects fields back in <3 s) and **batch** (an overnight job re-processes historical documents, millions of them). The rollout was signed off with "the platform autoscales on load."

**The incident.** A regulatory data-remediation programme kicked off a large batch re-processing run at 2 p.m. on a business day (someone didn't wait for the overnight window). Within minutes, interactive p99 TTFT went from 800 ms to **47 seconds**. Analysts couldn't work. The batch job itself ran fine.

**Investigation.**
- The gateway had no traffic-class separation. Batch and interactive requests went into the *same* vLLM waiting queue, FIFO. The batch job submitted thousands of requests; interactive requests queued behind them.
- Continuous batching was working as designed — it just had nothing to do with *fairness*. Once the running batch was full of batch-job requests (many with long outputs), interactive requests waited in the queue for slots.
- "Autoscaling" was configured: a HES/HPA rule to add a replica when queue depth > threshold. It fired. But bringing up a new replica meant pulling a ~90 GB container image and loading ~140 GB of weights across 8 GPUs — **4 minutes 40 seconds** measured cold start. The burst saturated the platform in under 90 seconds. By the time the new replica was ready, the batch job had front-loaded most of its work; the replica came up, drained the backlog, and scaled back down — having done nothing for the analysts during the window that mattered.
- Root cause, stated in the domain's recurring form: **the capacity was declared "autoscaled" but the scaling latency (4m40s) was longer than the burst it was supposed to absorb (~90s), so the elastic capacity did not, in practice, exist for this failure.** And there was no isolation between a best-effort workload and a latency-critical one sharing the same finite resource.

**Fix.**
1. **Physically separate the workloads.** A dedicated interactive replica pool (2 replicas, reserved, never used by batch) and a separate batch pool. The gateway routes by traffic class. An OTP-style priority lane, exactly as Module 180 §12 argued for notifications: a priority *field* on a shared queue can't rescue a latency-critical request from behind a flood; separate capacity can.
2. **Admission control on the batch class**: a token-bucket rate limiter so the batch job can never submit faster than the batch pool drains, with backpressure to the job.
3. **Warm pool** for the interactive class: one pre-loaded standby replica (weights resident, container running, not in rotation) so a real scale-up is ~20 s, not ~5 min. Accept the idle GPU cost as the price of the SLO.
4. **Smaller quantized fallback**: an INT4 version of the model on a single GPU as an emergency interactive tier — degraded extraction accuracy, but a 2-second answer beats a 47-second one, and the gateway can shed to it under pressure.
5. **Autoscaler signal changed** from queue depth to a leading indicator (TTFT p95 trend + arrival rate derivative) and its scale-down given a long cooldown so it stops thrashing.

**Lessons.**
- **"Autoscaled" is a claim about a time constant, not a boolean.** If your scale-up latency exceeds your burst duration, you are not autoscaled for that burst — you are just eventually-correctly-sized. State the number.
- **A best-effort workload and a latency-critical workload cannot share a finite resource without isolation** — priority fields don't substitute for reserved capacity.
- **Cold start dominates GPU elasticity.** Weight load and image pull are minutes. Warm pools, image caching on local NVMe, and model-weight caching are not optimisations, they're the difference between elastic and not.
- The whole platform was correctly *built*; it failed on an operational property (scaling latency vs burst duration) that no functional test exercised — a §14-shaped gap.

---

## 5. Best Practices

- **Use a purpose-built inference server** (vLLM / TensorRT-LLM / SGLang / TGI). Continuous batching + PagedAttention are not things to reimplement.
- **Separate traffic classes onto separate capacity** — interactive vs batch, and per-tenant if isolation matters. Priority fields on a shared queue are not isolation.
- **Split your SLO into TTFT and TPOT** and load-test against realistic *distributions* of input and output length, not fixed sizes — the tail is where you live.
- **Quantize to FP8/INT8 weight-only by default**, gated on an eval-set regression check (Module 184). Reserve INT4 for hard fit constraints, verified.
- **Enable prefix caching** for RAG/agent workloads with stable long prefixes — but scope the cache key to the tenant/isolation boundary.
- **Keep tensor parallelism within a node**; scale throughput with data-parallel replicas behind a token-aware router (least-outstanding-tokens, not least-connections).
- **Warm pools + local weight caching** so a scale-up is seconds. Budget the idle capacity as an SLO cost.
- **Cap `max_model_len` and per-request `max_tokens`** at the serving layer — one unbounded long-context or runaway-output request degrades the whole batch.
- **Benchmark tokens/$/SLO**, not tokens/sec in isolation. Utilisation is the economic variable; a fast platform at 20% utilisation is a expensive platform.
- **Instrument with OpenTelemetry**: queue depth, batch size, KV-cache utilisation, TTFT/TPOT histograms, prefix-cache hit rate, per-tenant token throughput.

---

## 6. Anti-patterns

- **`model.generate()` in a `for` loop / static batching in production** — throws away 2–4× throughput and destroys tail latency under variable output lengths.
- **One shared pool for interactive + batch** — §4. A best-effort flood starves the latency-critical class.
- **Autoscaling with a 5-minute cold start as your only burst defence** — the elastic capacity doesn't exist inside the burst window.
- **Shipping a quantization because output "looks fine"** — no eval regression; reasoning/code/math degrade silently first.
- **Over-parallelising** — TP=16 across two nodes over InfiniBand for a model that fits in one node with TP=8: every layer now pays inter-node all-reduce latency.
- **Prefix cache keyed on content only** — cross-tenant KV-block leakage (the cache-scoping class).
- **Unbounded `max_tokens` / `max_model_len`** — one request's KV cache evicts everyone; one runaway generation holds a batch slot for minutes.
- **Routing on connection count** — a replica with 3 connections each generating 4000 tokens is far busier than one with 10 connections doing 20 tokens each. Route on outstanding tokens / KV-cache load.
- **Measuring throughput at batch 1** or at 100% synthetic identical requests — tells you nothing about production.
- **No fallback tier** — when the primary pool is saturated there's nothing between "fast answer" and "47-second answer."

---

## 7. Performance Engineering

**The benchmarking method that actually predicts production:**

1. **Characterise real traffic**: histogram of input token lengths, output token lengths, arrival-rate pattern (including bursts), traffic-class mix. Synthetic fixed-length benchmarks over-report throughput by 2–5×.
2. **Sweep batch size** (`max_num_seqs`) and `max_num_batched_tokens` against the *distribution*, plotting throughput and TTFT/TPOT percentiles. Find the knee where p99 TPOT crosses your SLO.
3. **Roofline check**: compute the memory-bandwidth ceiling for decode at your batch size; if you're far below it, something (Python overhead, small batch, bad kernels) is the bottleneck, not the hardware.
4. **KV-cache pressure test**: replay a trace with the real fraction of long-context requests; watch for eviction/recompute thrash and OOM.
5. **Quantization A/B**: latency and tokens/$ *and* the Module 184 eval score, side by side. A quantization that saves 30% cost and loses 4 points of extraction accuracy is a business decision, not an infra one.
6. **Report the economic metric**: tokens per dollar at the SLO, and platform utilisation. That's what a Principal takes to the cost review.

Common findings: prefill-heavy (RAG) workloads are TTFT-bound and benefit from chunked prefill + prefix caching; chat/agent workloads are decode-bound and benefit from bigger batches + KV quantization; code/generation workloads have long outputs that need output caps and separate capacity so they don't hog slots.

---

## 8. Security

| Threat | Vector | Mitigation |
|---|---|---|
| **Model-weight exfiltration** | A compromised serving node; weights are high-value IP (a fine-tune encodes proprietary data — Module 183) | Encrypted weights at rest; node hardening; egress control on the serving subnet; no weight files on general-purpose hosts; attestation |
| **Cross-tenant KV / prefix-cache leakage** | Prefix cache keyed on content only serves tenant A's cached KV blocks to tenant B | Include tenant/isolation dimension in the prefix-cache key; or restrict prefix sharing to within a tenant; per-tenant cache namespaces |
| **Prompt/response logging exposure** | Serving logs and traces contain client PII / PANs (PCI, GDPR) | DLP redaction on log write (Module 181 §8); short retention; access-controlled; the log store is in PII scope |
| **Resource-exhaustion / DoS** | Adversarial input forcing max-length pathological generation; many huge-context requests to blow the KV cache | Per-request `max_tokens` and `max_model_len` caps; per-tenant token-rate quotas; admission control; separate capacity per tenant |
| **Model-extraction / distillation attack** | An API consumer harvests many input/output pairs to train a clone | Rate limiting, anomaly detection on query patterns, output watermarking where feasible, contractual terms |
| **Prompt injection reaching tools** | Covered in Modules 163/166/167 — the serving layer is not where this is solved | Gateway-level input handling; the serving layer enforces caps and isolation, not semantic safety |
| **Supply chain** | A malicious model file / tokenizer / custom kernel from a public hub | Pin and hash model artefacts; scan; SBOM for the runtime; build inference images from a trusted base (Module 28) |

The residency point that motivates self-hosting is itself a control: inference on prompts containing client data runs in the permitted region/VPC with no third-party egress — but only if the serving subnet's egress is actually locked down, not just assumed.

---

## 9. Scalability

- **Vertical (fit the model)**: quantization → fewer GPUs; TP within a node; PP across nodes only if forced. This is a one-time sizing decision per model.
- **Horizontal (throughput)**: data-parallel replicas behind a token-aware router. Linear until you hit shared bottlenecks (the router, the gateway's semantic cache, a shared prefix-cache service, network).
- **Elasticity**: the hard part. GPU cold start (image + weights) is minutes. Levers: warm standby pool (idle-cost trade), model weights cached on node-local NVMe, pre-pulled images, smaller quantized emergency tier, and scaling on a *leading* signal (arrival-rate derivative, TTFT trend) not a lagging one (queue depth). Accept that GPU elasticity has a floor of tens of seconds even done well.
- **Capacity planning**: GPUs are supply-constrained and lead times are long. Reserve baseline capacity; treat cloud on-demand GPU as the burst tier and know it can be *unavailable* during industry-wide crunches. Model a market-event 10× burst explicitly (Module 180 §12).
- **Multi-region**: replicate per region for residency and DR; route by tenant/data domicile; each region sized for its own peak, not the global average.
- **CAP posture**: inference is stateless request/response — it's an AP, horizontally-scaled tier. The stateful pieces (prefix cache, semantic cache, model registry) are separate and can be CP where correctness matters (a wrong cached response is worse than a slow one).
- **Cost ceiling as a scaling limit**: a hard monthly GPU budget is a real constraint — the autoscaler needs an upper bound and a shed-to-fallback policy when it's hit, or the platform's failure mode is a surprise invoice.

---

## 10. Interview Questions

### Basic (10)

**B1. Q: What are the two phases of an LLM inference request and how do their resource profiles differ?**
*Ideal answer:* Prefill processes all input tokens in one forward pass, builds the KV cache, and produces the first output token — it's compute-bound and scales with input length; its latency is TTFT. Decode generates output tokens one at a time, each step reading all weights and the full KV cache from memory to produce one token — it's memory-bandwidth-bound, with the GPU's compute mostly idle; its latency per token is TPOT/ITL. The opposite profiles drive most serving optimisations.
*Why correct:* Names both phases, the compute-vs-bandwidth distinction, and the two latency metrics.
*Common mistakes:* Thinking generation is compute-bound; not separating TTFT from TPOT.
*Follow-up:* "Why does batching help decode so much more than prefill?" / "Which phase does a long RAG context stress?"

**B2. Q: Why does batching improve LLM inference throughput?**
*Ideal answer:* In decode, the model reads all its weights from memory for every token but does very little compute per weight (arithmetic intensity ~1). At batch size 1 the GPU's compute sits idle waiting on memory. Batching N requests reads the weights once and reuses them across all N, raising compute utilisation ~N× until a memory limit (usually the KV cache) is hit. Throughput scales nearly linearly with batch size in that regime.
*Why correct:* Explains the memory-bound mechanism and why reuse across the batch is the win.
*Common mistakes:* "It parallelises the requests" without the memory-reuse reason; assuming it's free (ignores KV-cache limit and latency).
*Follow-up:* "What caps the batch size?" / "What does batching cost you in latency?"

**B3. Q: What is the KV cache and why does it matter for capacity planning?**
*Ideal answer:* For every token in context, each layer stores that token's key and value vectors per attention head, so attention doesn't recompute them each step. Its size is linear in sequence length × batch size × layers × KV heads × head dim. It often consumes more GPU memory than the model weights at reasonable batch sizes and context lengths, so it — not the weights — is what caps how many concurrent requests you can serve, and long-context requests are disproportionately expensive.
*Why correct:* Correct mechanism, the linear-in-length property, and the "caps concurrency" consequence.
*Common mistakes:* Thinking weights dominate memory; forgetting it scales with batch and length together.
*Follow-up:* "How do GQA and KV-cache quantization help?" / "What's the KV cache for a 70B model at 8k context, roughly?"

**B4. Q: What is continuous batching and why is it better than static batching for LLMs?**
*Ideal answer:* Static batching runs a fixed group of requests together until all finish, so one long generation keeps the other slots idle for its whole duration — disastrous when output lengths vary 10–100×. Continuous (iteration-level) batching schedules at each decode step: finished requests leave the batch and waiting ones join immediately, so short requests flow through while a long one stays resident. It's typically 2–4× more throughput and far better tail latency.
*Why correct:* Names the variable-output-length problem and the step-level scheduling fix.
*Common mistakes:* Confusing it with just "a bigger batch"; not knowing output-length variance is the reason.
*Follow-up:* "What is chunked prefill and what problem does it solve?" / "Which server implements this?"

**B5. Q: When should a company self-host an LLM instead of using a hosted API?**
*Ideal answer:* When at least one of: very high sustained volume where amortised GPU cost beats per-token pricing at high utilisation; data residency/isolation requiring inference in a specific region or VPC with no third-party egress; a latency floor the provider's shared queue can't guarantee; a custom model (fine-tune/distilled/open-weight) with no hosted endpoint; or a need for capacity guarantees during demand spikes. Otherwise the hosted API is cheaper all-in once you price GPU ops, on-call, and utilisation risk.
*Why correct:* Gives the specific triggers and the default-to-API reasoning.
*Common mistakes:* "It's always cheaper to self-host" (only at high utilisation); ignoring operational cost.
*Follow-up:* "At what utilisation does self-hosting break even?" / "What's the hidden cost of self-hosting?"

**B6. Q: What is quantization in LLM serving and what does it buy you?**
*Ideal answer:* Storing weights and/or activations (and optionally the KV cache) in fewer bits than FP16 — FP8, INT8, INT4. It reduces the memory traffic that decode is bottlenecked on (lower TPOT), lets the model fit on fewer GPUs, and increases batch capacity (for KV-cache quantization). The cost is some accuracy loss that is task-dependent and hits reasoning/code/math first, so it must be validated on an eval set.
*Why correct:* Names the memory/fit/latency benefits and the task-dependent accuracy cost with a validation requirement.
*Common mistakes:* Assuming zero quality cost; not distinguishing weight-only from weight+activation from KV-cache quantization.
*Follow-up:* "Which quantization would you default to and why?" / "How do you decide INT4 is acceptable?"

**B7. Q: What's the difference between tensor parallelism and pipeline parallelism?**
*Ideal answer:* Tensor parallelism shards each layer's weight matrices across GPUs so every GPU computes part of every layer; it needs an all-reduce every layer, so it requires a fast interconnect (NVLink) and is kept within one node. Pipeline parallelism assigns whole layers to different GPUs and passes activations stage to stage; it tolerates slower links and spans nodes, but introduces pipeline "bubbles" (idle time) unless micro-batched. TP favours latency; PP favours cross-node throughput.
*Why correct:* Correct split granularity, communication pattern, interconnect requirement, and the bubble caveat.
*Common mistakes:* Swapping the two; not knowing TP needs NVLink; forgetting pipeline bubbles.
*Follow-up:* "How would you deploy a model that fits in 8 GPUs but you have 24?" / "Why not always use tensor parallelism?"

**B8. Q: What is TTFT and what is TPOT, and why report both?**
*Ideal answer:* TTFT (time to first token) is how long until the stream starts — dominated by queueing plus prefill, so it scales with input length and load. TPOT (time per output token, a.k.a. inter-token latency) is the steady-state generation speed; total generation time ≈ output_tokens × TPOT. They have different causes and different fixes (TTFT: queue/prefill/prefix-cache; TPOT: batch size/quantization/KV pressure), so a single "latency" number hides which one is failing.
*Why correct:* Defines both, their causes, and why one aggregate is insufficient.
*Common mistakes:* Reporting only end-to-end latency; conflating the two.
*Follow-up:* "A user says 'it's slow to start' — which metric and which fix?" / "Which matters more for a chat UI vs a batch extraction job?"

**B9. Q: What is prefix caching and which workloads benefit most?**
*Ideal answer:* Reusing the computed KV cache for a shared prompt prefix across requests, so the prefill cost of that prefix is paid once. Workloads with a long, stable prefix and many requests benefit most: RAG (fixed instructions + often-repeated retrieved context), agents (long stable system prompt across many turns), and few-shot prompts with fixed examples. It cuts TTFT sharply on cache hits.
*Why correct:* Correct mechanism and the "long stable prefix, many requests" criterion with concrete workloads.
*Common mistakes:* Confusing it with semantic caching of full responses; not noting it's a TTFT (prefill) optimisation.
*Follow-up:* "What's the security risk of prefix caching in multi-tenant serving?" / "How is it different from the semantic cache in Module 165?"

**B10. Q: Why is GPU autoscaling harder than autoscaling stateless web servers?**
*Ideal answer:* Cold start is minutes, not seconds: a new replica must pull a large container image and load tens to hundreds of GB of weights across multiple GPUs before serving a request. GPUs are also supply-constrained and expensive, so you can't over-provision cheaply, and on-demand capacity can be unavailable during industry crunches. So elasticity has a floor of tens of seconds even when done well (warm pools, cached weights), and bursts shorter than the scale-up time aren't covered.
*Why correct:* Names weight-load cold start, cost/supply constraints, and the burst-vs-scale-latency gap.
*Common mistakes:* Treating it like HPA on CPU pods; ignoring weight-load time.
*Follow-up:* "How do you make a scale-up take 20 seconds instead of 5 minutes?" / "What do you do about a burst shorter than your scale-up time?"

### Intermediate (10)

**I1. Q: Walk through how you'd load-test an inference deployment so the results predict production.**
*Ideal answer:* Start from real traffic: histograms of input and output token lengths, the arrival-rate pattern including bursts, and the traffic-class mix. Generate synthetic load that matches those *distributions*, not fixed sizes (fixed-length tests over-report throughput 2–5×). Sweep `max_num_seqs` and `max_num_batched_tokens`, plotting throughput and TTFT/TPOT percentiles; find the knee where p99 TPOT crosses the SLO. Replay a trace with the real long-context fraction to test KV-cache pressure and eviction. Do a roofline check to see if you're memory-bandwidth-limited (hardware ceiling) or something else (Python overhead, small batch). Report tokens/$ at the SLO and platform utilisation.
*Why correct:* Distribution-based load, parameter sweep against percentiles, KV pressure replay, roofline, and the economic metric.
*Common mistakes:* Fixed-length synthetic load; measuring throughput without a latency SLO; batch-1 numbers.
*Follow-up:* "Why do fixed-length benchmarks over-report?" / "What does a roofline check tell you here?"

**I2. Q: Your chat product has good median latency but p99 TPOT spikes for some users. What are the likely causes and fixes?**
*Ideal answer:* Likely causes: (a) a few very-long-context requests in the batch inflating per-step time and KV-cache pressure for everyone; (b) large prefills of newly-arriving requests stalling the decode step (no chunked prefill); (c) batch size set too high so each decode step is long; (d) KV-cache near capacity causing eviction/recompute; (e) a noisy-neighbour tenant. Fixes: cap `max_model_len` and per-request `max_tokens`; enable chunked prefill; tune batch size down to meet p99 TPOT; add KV-cache quantization or more capacity; separate long-context or heavy tenants onto their own pool; route on outstanding-token load.
*Why correct:* Enumerates the batch-interference causes and matched fixes.
*Common mistakes:* Only adding GPUs; not considering prefill/decode interference; ignoring per-request caps.
*Follow-up:* "How does chunked prefill help here specifically?" / "Why can raising batch size hurt p99 while helping throughput?"

**I3. Q: How do you decide between FP8, INT8 weight-only, and INT4 for a given model and workload?**
*Ideal answer:* Default to FP8 (or INT8 weight-only) — on modern hardware the quality cost is usually negligible and you get lower TPOT and better fit. Validate on the workload's eval set (Module 184) regardless, because reasoning/code/math degrade first. Go to INT4 only when you must fit a larger model on smaller/fewer GPUs and the eval shows the accuracy loss is acceptable for that specific task; INT4 helps decode latency more than prefill. Consider KV-cache quantization independently — it's often a near-free 2× batch-capacity gain. Never ship any quantization without the regression check against real quality metrics.
*Why correct:* Default + validate, the task-dependence, the INT4 "only if forced and verified" rule, and KV quantization as orthogonal.
*Common mistakes:* Choosing by memory savings alone; skipping eval; assuming INT4 is fine because output is fluent.
*Follow-up:* "Which tasks would make you distrust INT4?" / "How big an eval set do you need to trust the result?"

**I4. Q: How should the model gateway route requests across replicas?**
*Ideal answer:* Not by connection count or round-robin — LLM request cost varies by orders of magnitude (output length, context length). Route by current load in a token-aware sense: least outstanding tokens, or lowest KV-cache utilisation, or shortest expected time-to-availability. The gateway also handles auth/quota, per-tenant rate limits, traffic-class routing to separate pools, semantic caching (Module 165), prompt DLP (Module 181), fallback to a smaller/quantized tier under pressure, and metrics. Keep it stateless and horizontally scaled so it's not the bottleneck.
*Why correct:* Token-aware routing rationale plus the gateway's full responsibility set.
*Common mistakes:* Least-connections routing; putting heavy state in the gateway; no fallback tier.
*Follow-up:* "Why is least-connections wrong for LLMs specifically?" / "What does the gateway do when every replica is saturated?"

**I5. Q: Explain prefix caching's cross-tenant risk and how you'd prevent it.**
*Ideal answer:* Prefix caching shares computed KV blocks between requests with an identical prompt prefix. If the cache key is derived only from token content, a request from tenant B with a prefix identical to tenant A's cached prefix can be served A's KV blocks — and if prefixes ever contain tenant-specific or sensitive content, that's a cross-tenant information path. It's the same cache-key-scoping failure class as semantic caches and UI list keys elsewhere in this course. Prevention: include the tenant/isolation dimension in the prefix-cache key, or restrict prefix sharing to within a single tenant, with per-tenant cache namespaces; and treat "prefixes may contain sensitive data" as the default assumption.
*Why correct:* Names the content-only-key flaw, the leakage path, the failure class, and both scoping fixes.
*Common mistakes:* Assuming shared system prompts make it safe; not connecting it to the broader cache-scoping pattern.
*Follow-up:* "When is unscoped prefix sharing actually safe?" / "How would you detect a leak like this?"

**I6. Q: A single H100-hour is ~$3. Sketch the cost model for deciding self-host vs API for a 500M-token/day workload.**
*Ideal answer:* Self-host: model fits on (say) 2×H100 per replica; throughput per replica at your SLO from a benchmark — say 3,000 tokens/s sustained ⇒ ~260M tokens/replica/day at 100% utilisation, ~130M at a realistic 50%. So ~4 replicas = 8 GPUs ≈ $24/hr ≈ $17.5k/month, plus ops, on-call, a warm standby, and burst headroom — call it $30–40k/month all-in. API: 500M tokens/day × 30 × blended $/token — at ~$3/1M input-heavy blended that's ~$45k/month, at ~$1/1M it's ~$15k/month. So the answer turns entirely on the per-token price you'd pay and your achievable utilisation: self-host wins clearly only if utilisation stays high and the API price for your token mix is at the higher end, or if residency/latency/custom-model reasons force it regardless.
*Why correct:* Shows the arithmetic, centres utilisation and blended price as the swing variables, and notes non-cost drivers.
*Common mistakes:* Comparing GPU sticker price to API price without utilisation; ignoring ops/on-call/standby.
*Follow-up:* "What utilisation assumption is safe to plan on?" / "How does a fine-tuned model change this decision?"

**I7. Q: What is speculative decoding and when does it actually help?**
*Ideal answer:* A small draft model proposes k tokens; the large target model verifies all k in one forward pass, accepting the correct prefix and falling back on the first mismatch. If acceptance is high, you get the same output with 2–3× fewer expensive target-model steps. It helps in the latency-bound, low-batch regime where the GPU has spare compute to spend on verification. At high batch, the GPU is already compute-saturated by batching, so speculation adds overhead for little gain. Acceptance rate is workload-dependent and must be measured; variants (Medusa, EAGLE, lookahead) avoid a separate draft model.
*Why correct:* Mechanism, the low-batch/latency-bound applicability, the high-batch non-benefit, and the measure-acceptance caveat.
*Common mistakes:* Assuming it always speeds things up; not knowing it trades compute for steps.
*Follow-up:* "Why doesn't it help at batch size 128?" / "What acceptance rate makes it worthwhile?"

**I8. Q: How do you size tensor parallelism for a model?**
*Ideal answer:* Use the minimum TP degree that fits the model weights *plus* a useful KV cache *plus* activation memory on the available GPUs, and keep TP within a single NVLink node (≤8 GPUs). Every additional TP rank adds an all-reduce per layer, so more TP than needed just adds latency. Once the model fits, scale throughput with data-parallel replicas of that TP unit, not by increasing TP. Only cross a node boundary with pipeline parallelism, and only when a single node genuinely can't hold the model.
*Why correct:* "Minimum TP to fit, within a node, then DP for throughput" — the standard rule with the latency rationale.
*Common mistakes:* Maxing out TP for "more parallelism"; spanning nodes with TP over slower links.
*Follow-up:* "What breaks if you run TP=16 across two nodes over InfiniBand?" / "How does the KV cache factor into TP sizing?"

**I9. Q: Your autoscaler is thrashing — adding and removing GPU replicas every few minutes. Diagnose and fix.**
*Ideal answer:* Likely: scaling on a lagging, noisy signal (instantaneous queue depth) with symmetric, short cooldowns, so a transient spike triggers scale-up, the new replica drains the backlog, load drops, scale-down fires, then the next spike repeats — and each cycle pays a multi-minute cold start for nothing. Fixes: scale on a smoothed leading indicator (arrival-rate trend, TTFT p95 trend) with hysteresis (different up/down thresholds); long scale-down cooldown (minutes to tens of minutes); a minimum replica floor sized to baseline; a warm pool so scale-ups are cheap enough that occasional over-scaling doesn't hurt; and cap the max to a budget.
*Why correct:* Identifies the lagging-signal + short-cooldown loop and prescribes smoothing, hysteresis, floors, warm pool, and ceiling.
*Common mistakes:* Just widening the threshold; not adding hysteresis; scaling on queue depth alone.
*Follow-up:* "Why is queue depth a bad scaling signal here?" / "What's the cost trade-off of a large scale-down cooldown?"

**I10. Q: How do you run interactive and batch inference workloads on shared GPU infrastructure without the batch job starving interactive users?**
*Ideal answer:* Don't share the pool. Reserve dedicated capacity for the interactive class that the batch class can never consume, and route by traffic class at the gateway. Put admission control (a token-bucket rate limiter with backpressure) on the batch class so it can't submit faster than its pool drains. If cost pressure forces some sharing, use strict priority preemption at the scheduler *and* a hard cap on batch's share of slots — but reserved capacity is the reliable answer. A priority field on one shared queue does not rescue a latency-critical request from behind thousands of queued batch requests.
*Why correct:* Reserved capacity + class routing + batch admission control, with the "priority field ≠ isolation" point.
*Common mistakes:* Relying on a priority field alone; letting batch autoscale into the interactive pool.
*Follow-up:* "What if the business won't pay for reserved idle interactive capacity?" / "How does this mirror the Module 180 notification-priority argument?"

### Advanced (10)

**A1. Q: Design the request scheduler for a continuous-batching inference server. What decisions does it make each step, and what are the tuning tensions?**
*Ideal answer:* Each decode step the scheduler decides: which running requests continue (all not-yet-finished); whether to admit waiting requests into free slots (bounded by `max_num_seqs` and available KV blocks); whether to run prefill for newly-admitted requests this step or defer, and if running it, whether to chunk a long prompt's prefill across steps (`max_num_batched_tokens` budget) so it doesn't stall decode; and preemption/eviction if KV memory is exhausted (evict the newest or lowest-priority request's KV cache and recompute later, or swap to CPU). Tensions: bigger batch = more throughput but longer per-step time (worse TPOT) and more KV pressure; admitting prefill promptly = better TTFT but stalls decode TPOT for everyone; aggressive KV packing = higher concurrency but eviction/recompute thrash under long-context load. Priorities/traffic classes add a fairness dimension on top.
*Why correct:* Enumerates the per-step decisions (continue, admit, prefill/chunk, evict) and the throughput/TTFT/TPOT/KV tensions.
*Common mistakes:* Describing static batching; omitting chunked prefill and eviction; no mention of the latency/throughput tension.
*Follow-up:* "How would you add strict-priority traffic classes to this?" / "Eviction vs CPU-swap for KV under pressure — trade-offs?"

**A2. Q: A market-data-summarisation feature must serve a 10× load spike during the first 15 minutes of a major economic release, every time, predictably. Design the capacity strategy.**
*Ideal answer:* Predictable spike ⇒ don't rely on reactive autoscaling (cold start > useful reaction time). (1) **Scheduled pre-scaling**: bring capacity to 10× before the known release time via a cron/calendar-driven scaler, hold through the window, scale down after. (2) **Reserved baseline + warm pool**: enough always-on capacity for normal load plus a warm standby set that's pre-loaded and joins in seconds. (3) **Graceful degradation ladder**: under pressure, shed to a smaller/quantized model, shorten `max_tokens`, disable non-essential features, serve cached summaries for unchanged inputs — a defined ladder, not ad hoc. (4) **Admission control + queue with a deadline**: reject or defer low-priority requests rather than letting the queue grow unbounded. (5) **Load-test against the real 10× profile** including input/output length distribution. (6) Capacity contract with the cloud provider or reserved instances so the GPUs are actually available that morning.
*Why correct:* Scheduled pre-scaling for a known event, warm capacity, a degradation ladder, admission control, and capacity assurance — not reactive autoscaling.
*Common mistakes:* "The autoscaler will handle it"; no degradation plan; assuming on-demand GPUs will be available.
*Follow-up:* "What exactly is on your degradation ladder and in what order?" / "How do you validate the pre-scale actually completed before the release?"

**A3. Q: How do you validate that a quantized model is safe to ship for a regulated document-extraction workload?**
*Ideal answer:* Treat it as a model change requiring the full evaluation gate (Module 184): a representative, versioned eval set of real documents with ground-truth fields; measure field-level precision/recall and exact-match against the FP16 baseline, sliced by document type, language, and the hard/rare cases; set a regression threshold agreed with the business/risk owner (e.g. no field's recall drops >0.5pp, no critical field regresses at all). Include adversarial/edge inputs. If it passes, record the eval result as the release evidence and pin the quantized artefact by hash. If a regulated field regresses at all, don't ship it for that field's documents — possibly route those to the FP16 tier. Re-run the eval on every model or runtime change (Module 162 §14 — "pinned" can still drift).
*Why correct:* Full eval gate, sliced metrics vs baseline, agreed thresholds, critical-field protection, artefact pinning, re-run on change.
*Common mistakes:* Spot-checking a few outputs; one aggregate accuracy number; no per-field or per-slice view; no baseline comparison.
*Follow-up:* "Which slices would you insist on?" / "The quantized model is 30% cheaper and loses 1pp average recall — who decides, and on what basis?"

**A4. Q: Explain prefill/decode disaggregation and argue for or against it for a mid-size internal platform.**
*Ideal answer:* Disaggregation runs prefill and decode on *separate* GPU pools: the prefill pool processes prompts and produces KV caches, which are transferred to the decode pool that generates tokens. Rationale: prefill (bursty, compute-heavy, long) and decode (steady, bandwidth-bound) interfere when co-located — a big prefill stalls everyone's decode. Separating them lets each pool be tuned and scaled independently and removes the interference, improving interactive TPOT stability. Cost: a KV-cache transfer over fast interconnect per request, more moving parts, and two pools to size. For a mid-size internal platform, it's usually **not** worth it — chunked prefill plus separate traffic-class pools captures most of the interference benefit at far lower complexity. Reach for disaggregation at large scale with strict interactive TPOT SLOs and enough traffic to keep both specialised pools well-utilised.
*Why correct:* Correct mechanism and rationale, honest cost, and a scale-appropriate "not yet" recommendation with the cheaper alternative.
*Common mistakes:* Recommending it for everyone; not knowing chunked prefill addresses much of the same problem.
*Follow-up:* "What does the KV transfer cost and how do you hide it?" / "At what scale would you revisit?"

**A5. Q: Your platform serves five internal teams from a shared model. Team D's misbehaving client sends 50k-token contexts in a loop and everyone's latency degrades. Design the isolation.**
*Ideal answer:* Multiple layers: (1) **Per-tenant token-rate quotas** at the gateway (tokens/sec and concurrent requests), enforced with a token bucket; Team D throttled to its allocation, others unaffected. (2) **Per-request caps** — `max_model_len` and `max_tokens` ceilings so no single request can be pathological. (3) **KV-cache fair-share** in the scheduler — cap the fraction of KV blocks any one tenant can hold. (4) For strong isolation, **separate replica pools** per tenant or per tier, sized to their committed capacity, so a noisy tenant's blast radius is its own pool. (5) **Observability per tenant** — token throughput, KV utilisation, error rate — so you detect and attribute this in minutes. (6) **Admission control** that rejects rather than queues when a tenant is over quota, with a clear error. The principle: shared infrastructure needs per-tenant resource governance or the worst-behaved tenant sets everyone's latency.
*Why correct:* Layered — quotas, per-request caps, KV fair-share, optional pool separation, per-tenant observability, reject-don't-queue.
*Common mistakes:* Only adding capacity; no per-tenant metrics; queueing over-quota requests instead of rejecting.
*Follow-up:* "Quota exceeded — reject or degrade? On what basis?" / "How do you set each tenant's quota fairly?"

**A6. Q: Weights for your fine-tuned model are proprietary and encode training data derived from client information. How do you protect them in a self-hosted serving deployment?**
*Ideal answer:* Treat the weights as crown-jewel IP and as regulated data by derivation. Controls: encrypted at rest (and in transit during replica load); stored only in an access-controlled artefact registry, pulled to GPU nodes just-in-time, never left on general-purpose or developer hosts; the serving subnet has locked-down egress (no path to copy weights out); node hardening and, where available, confidential-computing / attestation so a compromised host can't trivially dump GPU memory; artefact pinning by hash and a signed supply chain; audit logging of every weight pull; and a defined incident response if a node is compromised (rotate, re-key, assess exposure). Also limit who can *produce* a fine-tune and where the training data lives (Module 183). Model-extraction defences (rate limits, query anomaly detection) protect against reconstruction via the API.
*Why correct:* Encryption, JIT pull, egress lockdown, host hardening/attestation, signed pinned artefacts, audit, IR, plus extraction defences.
*Common mistakes:* Treating weights as ordinary binaries; weights sitting on shared storage; no egress control on the serving subnet.
*Follow-up:* "How would weights actually leak in a realistic breach?" / "What's your response if a serving node is compromised?"

**A7. Q: Compare vLLM, TensorRT-LLM, and a hosted API for a team that needs to ship in a quarter. What decides it?**
*Ideal answer:* **Hosted API**: fastest to ship, zero GPU ops, elastic, per-token cost; ruled out only by residency, a custom model, a latency floor, or extreme volume economics. **vLLM**: open-source, broad model support, fast to stand up, strong continuous batching + PagedAttention + prefix caching, good enough perf for most; you own the GPU ops. **TensorRT-LLM**: highest peak performance on NVIDIA hardware (fused kernels, aggressive quantization, in-flight batching), but a heavier build/compile step per model/config, tighter hardware coupling, and more engineering to operate. Decider: if a hosted API meets residency/latency/model needs, use it and spend the quarter on the product. If you must self-host, default to vLLM to ship in the quarter; move to TensorRT-LLM later only if a measured perf/cost gap justifies the extra operational weight.
*Why correct:* API-first, vLLM as the pragmatic self-host default, TensorRT-LLM as a later perf play, with the decision criteria.
*Common mistakes:* Chasing peak benchmark numbers under a deadline; ignoring that the API might just work.
*Follow-up:* "What measured gap would justify moving to TensorRT-LLM?" / "What do you lose by not using the API?"

**A8. Q: How do you set and monitor SLOs for an LLM serving platform, and how do they differ from a normal microservice?**
*Ideal answer:* Split into **TTFT** and **TPOT** percentiles (p50/p95/p99), per traffic class and ideally per model — plus a **completion-rate** SLI (requests that finished without error/timeout) and a **throughput-at-SLO** capacity metric. Differ from a normal service: latency depends heavily on input/output length, so SLOs should be conditioned on or normalised by token counts (e.g. TPOT, not total latency; TTFT bucketed by prompt length); "success" includes not being truncated by a `max_tokens` cap the user didn't expect; and cost-per-request is variable and worth an SLO-adjacent budget metric. Monitor queue depth, batch size, KV-cache utilisation, prefix-cache hit rate, and per-tenant token throughput as the leading indicators. Alert on TTFT/TPOT trend and KV pressure before they breach.
*Why correct:* TTFT/TPOT split, per-class/per-model, completion-rate and throughput-at-SLO, token-conditioned targets, and the leading indicators.
*Common mistakes:* One end-to-end latency SLO; ignoring token-length dependence; no capacity/cost SLI.
*Follow-up:* "Why condition TTFT on prompt length?" / "What leading indicator fires first before a TPOT breach?"

**A9. Q: A model upgrade (same family, newer version) is proposed. It's faster and scores higher on public benchmarks. What's your rollout process on a production serving platform?**
*Ideal answer:* Public benchmarks aren't your workload (Module 184). Process: (1) run your own eval set — task metrics, sliced, vs the incumbent as baseline, including regression on critical cases and format/schema adherence for structured outputs. (2) Perf/cost benchmark on your hardware with your traffic distribution — TTFT/TPOT/throughput/tokens-$. (3) Shadow or canary: mirror a fraction of real traffic to the new model, compare outputs and metrics offline, no user impact. (4) Progressive rollout (1% → 10% → 50% → 100%) with automated rollback on metric regression or error-rate spike. (5) Pin the exact artefact by hash; keep the old version deployable for fast rollback. (6) Watch for silent behaviour shifts in downstream consumers (prompt templates tuned to the old model, parsers expecting a certain output style). (7) Re-baseline the eval and re-verify prompts/tools against the new model.
*Why correct:* Own-eval-first, own-hardware perf, shadow/canary, progressive rollout with rollback, artefact pinning, downstream-impact watch.
*Common mistakes:* Trusting the benchmark; big-bang swap; not keeping the old version hot; forgetting prompt/parse coupling.
*Follow-up:* "What downstream breakage have you seen from a 'compatible' model bump?" / "What's your automated rollback trigger?"

**A10. Q: What is genuinely new about serving infrastructure risk versus the rest of this domain, and what is a re-instance of a known pattern?**
*Ideal answer:* **Re-instances**: the prefix-cache cross-tenant leak is the cache-key-scoping failure class (Modules 158/160/165); "autoscaled but scale latency > burst" is Module 180 §4's "the elastic capacity didn't exist for this failure" and the failure-presents-as-normal-activity shape; quantization shipped on vibes is Module 184's missing-eval-gate pattern; shared pool starvation is Module 180's priority-field-isn't-a-lane argument. **Genuinely new**: the resource being contended is a *physically scarce, minutes-to-provision, budget-capped* accelerator, so the usual "just autoscale" reflex fails structurally, and capacity planning becomes a supply-chain and procurement problem, not just a config value. And the performance model is bimodal (compute-bound prefill vs bandwidth-bound decode) in a way that makes a single latency SLO actively misleading. The synthesis: the *failure patterns* are familiar, but the *cost and elasticity constraints* of the hardware make the mitigations (reserved capacity, warm pools, degradation ladders, scheduled pre-scaling) mandatory rather than optional.
*Why correct:* Cleanly separates the re-instanced failure classes from the new hardware-economics constraint and the bimodal performance model.
*Common mistakes:* Claiming it's all new; missing that the cache/starvation/eval failures are known shapes.
*Follow-up:* "Which mitigation here has no analogue in stateless-service scaling?" / "Why does one latency SLO mislead here specifically?"

### Expert (FinTech Principal Panel)

**E1. Q: The firm wants an internal LLM platform serving 20+ teams, on-prem for residency, within a fixed annual GPU budget. As the Principal, lay out the architecture and the three decisions most likely to be wrong in 18 months.**
*Ideal answer:* Architecture: a **model gateway** (auth, per-tenant quota, routing, semantic cache, prompt DLP, fallback, OTel) in front of **per-tier replica pools** (interactive / batch / a small always-on emergency quantized tier), each pool a set of data-parallel replicas of a TP-within-node unit on vLLM/TensorRT-LLM, with paged KV + tenant-scoped prefix caching, a warm standby per interactive pool, scheduled pre-scaling for known market events, a degradation ladder, and a hard budget cap with shed-to-fallback. A **model registry** (pinned, hashed, signed artefacts) and an **eval gate** (Module 184) on every model/quantization/runtime change. Per-tenant metrics and chargeback. The three decisions most likely wrong later: (1) **which models to offer** — teams will want more/newer models than the budget supports; a governance process for model onboarding and sunset is needed from day one or the pool count explodes. (2) **quota allocation** — the initial per-team quotas will be wrong and contested; build the mechanism to adjust them continuously with usage data, not annually. (3) **the build-vs-buy line** — hosted APIs will improve and prices will fall; the decision to be fully on-prem should be revisited on a schedule against a hybrid (residency-sensitive workloads on-prem, the rest on a region-pinned managed endpoint), not treated as permanent.
*Why correct:* Complete architecture at the right altitude plus three specific, well-chosen future-wrong decisions with mitigations.
*Common mistakes:* Only the happy-path architecture; generic "it might not scale" risks; treating on-prem as forever.
*Follow-up:* "How do you sunset a model 3 teams depend on?" / "What triggers revisiting the on-prem decision?"

**E2. Q: Defend the tokens-per-dollar-at-SLO metric to a CFO who is looking at the raw GPU bill and asking why it's not lower.**
*Ideal answer:* The GPU bill is an input, not the outcome — the outcome is served work at the required quality and latency. Raw cost can always be cut by removing capacity, but that trades directly against TTFT/TPOT SLOs the business set, and against the reserved/warm capacity that exists specifically to survive market-event bursts (the alternative is an outage during the highest-visibility moments). The right lens is **cost per unit of served work at the SLO** and **platform utilisation**: if utilisation is low, there's genuine waste to reclaim (consolidate pools, right-size replicas, better routing, quantization, off-peak batch scheduling) — and I can show the utilisation number and a plan to raise it. If utilisation is already high, the bill is buying throughput the firm is consuming, and the lever is either demand governance (per-team quotas and chargeback so teams internalise cost) or accepting a lower SLO. I'd bring: current tokens/$, utilisation by pool, the top 3 efficiency initiatives with expected savings, and the SLO trade for any deeper cut.
*Why correct:* Reframes bill-as-input, ties cuts to SLO and burst-survival, offers utilisation as the honest waste signal, and brings a concrete plan plus a demand-governance lever.
*Common mistakes:* Getting defensive; agreeing to cut capacity without naming the SLO cost; no utilisation data.
*Follow-up:* "Utilisation is 35% — what's your plan and timeline?" / "What SLO would a 25% cost cut require?"

**E3. Q: An incident review finds that during a 6-minute GPU capacity shortfall, the platform silently served every request from the INT4 emergency tier instead of the FP16 model — and three teams' downstream numbers were subtly off for that window, discovered days later. What went wrong and what do you change?**
*Ideal answer:* The degradation ladder worked mechanically but was **invisible and unattributed**: consumers had no signal that they were getting degraded-quality output, so they treated it as normal, and the quality delta (small per response, material in aggregate for numeric extraction) surfaced only via downstream reconciliation days later — the failure-presents-as-success shape again. Changes: (1) **Every degraded response is labelled** — a response header / metadata field / trace attribute saying "served by: int4-emergency" — so consumers and dashboards can see it and exclude or flag it. (2) **A first-class metric and alert** on "fraction of traffic served degraded," visible to consuming teams, not just the platform team. (3) **Consumer contracts** state which use cases may accept degraded output and which must **fail closed** instead (a numeric-extraction feeding a regulatory report should error, not silently downgrade). (4) **A post-degradation reconciliation hook** — after any degradation window, notify affected consumers with the time range so they can re-process. (5) Review whether INT4 is even acceptable as a fallback for numeric tasks, or whether the fallback should be "queue and wait" / "smaller FP8 model" instead.
*Why correct:* Diagnoses invisible+unattributed degradation, fixes with labelling, a shared metric/alert, fail-closed contracts, a reconciliation hook, and reconsidering the fallback choice for that task class.
*Common mistakes:* "Add more capacity so it doesn't happen"; keeping degradation silent; no consumer notification.
*Follow-up:* "Which use cases should fail closed rather than degrade?" / "How do consumers re-process a 6-minute window after the fact?"

**E4. Q: How would you know if your inference platform were slowly getting less cost-efficient over months — not a single regression, but drift?**
*Ideal answer:* Instrument the efficiency trend, not just point health: (1) **tokens/$/SLO over time**, per model and per pool, as a tracked KPI with a target line. (2) **Utilisation trend** — if it's falling, capacity is being added faster than demand, or routing is degrading, or pools have fragmented. (3) **KV-cache and batch-size distributions** drifting down (smaller effective batches ⇒ worse economics) — often caused by the input/output length mix shifting (longer contexts as teams add RAG) or a creep in per-request `max_tokens`. (4) **Prefix-cache hit rate** trending down as prompt templates proliferate. (5) **Fallback/degraded fraction** creeping up (chronic under-capacity). (6) **Per-team token growth vs quota** — silent demand growth. Review quarterly with the numbers side by side; alert on divergence from the target trend, not absolute values. The pattern is the domain's recurring one: a slow degradation that each day looks normal is invisible unless you deliberately trend the thing it erodes.
*Why correct:* Names the specific efficiency signals (tokens/$, utilisation, batch/KV distributions, prefix hit rate, fallback fraction, per-team growth) and trend-based alerting.
*Common mistakes:* Only monitoring latency/errors; absolute thresholds; no per-model/per-pool breakdown.
*Follow-up:* "Batch sizes are trending down — what are the candidate causes and how do you tell them apart?" / "Who owns this KPI?"

**E5. Q: Give the most discriminating interview question you'd ask a Principal candidate about LLM serving, and contrast a strong and weak answer.**
*Ideal answer:* Question: **"You have a fixed GPU budget and an interactive SLO. Traffic just doubled. Walk me through every lever, in the order you'd pull them."** A **weak** answer jumps to "add GPUs" (there's no budget) or lists techniques with no order or trade-off reasoning. A **strong** answer sequences by cost and risk: first the free wins — routing improvements, `max_tokens` caps, prefix caching, batch-size tuning, off-peak-shifting batch work, killing waste from low-utilisation pools; then near-free — FP8/INT8 quantization gated on an eval check, KV-cache quantization; then trade-offs — a lower TPOT SLO, degradation ladder tuning, shedding low-priority tenants via quota; then structural — a smaller/distilled model for part of the traffic (Module 183), a hybrid burst to a region-pinned API if residency allows; and only then "buy more GPUs," with the utilisation and tokens/$ evidence to justify it. The tell: a strong candidate treats capacity as the *last* lever, quantifies each step, and names the SLO or quality cost of the ones that have one.
*Why correct:* The question forces prioritised, trade-off-aware lever ordering under a real constraint; the contrast identifies capacity-first and unordered-list as the weak tells.
*Common mistakes (weak answer):* "Add GPUs"; unordered technique dump; no eval gate on quantization; no SLO/quality cost named.
*Follow-up:* "Which of those levers has a quality cost and how do you bound it?" / "Where does a fine-tuned smaller model fit in that order?"

---

## 11. Coding Exercises

### Easy — KV cache size and max-batch calculator

**Problem.** Given model config and a GPU memory budget, compute per-token KV bytes, per-request KV bytes at a context length, and the max concurrent requests that fit after weights.

```python
from dataclasses import dataclass

@dataclass
class ModelCfg:
    n_layers: int
    n_kv_heads: int          # KV heads (GQA/MQA aware)
    d_head: int
    param_bytes: int         # total weight bytes (already quantization-adjusted)
    kv_dtype_bytes: int = 2  # FP16 KV by default; 1 for INT8 KV

def kv_bytes_per_token(cfg: ModelCfg) -> int:
    return 2 * cfg.n_layers * cfg.n_kv_heads * cfg.d_head * cfg.kv_dtype_bytes

def max_concurrent_requests(cfg: ModelCfg, gpu_bytes_total: int, gpu_count: int,
                            ctx_len: int, overhead_frac: float = 0.10) -> int:
    total = gpu_bytes_total * gpu_count
    usable = total * (1 - overhead_frac)          # activations, fragmentation, CUDA ctx
    for_kv = usable - cfg.param_bytes
    if for_kv <= 0:
        raise ValueError("weights do not fit; need more GPUs or heavier quantization")
    per_req = kv_bytes_per_token(cfg) * ctx_len
    return max(0, int(for_kv // per_req))

# Llama-3-70B-class, FP16 weights across 2x80GB
cfg = ModelCfg(n_layers=80, n_kv_heads=8, d_head=128, param_bytes=140 * 2**30)
print(kv_bytes_per_token(cfg))                                   # ~327680  (~320 KB)
print(max_concurrent_requests(cfg, 80 * 2**30, 2, ctx_len=8192)) # single-digit
print(max_concurrent_requests(cfg, 80 * 2**30, 2, ctx_len=2048)) # ~4x more
```

*Time / space:* O(1). *Optimised:* add a `kv_dtype_bytes=1` call to show INT8-KV roughly doubling capacity; extend to model INT4 weights by passing a smaller `param_bytes`; plot concurrency vs ctx_len to make the linear-in-length penalty visible.

### Medium — Continuous-batching scheduler simulation (throughput vs static)

**Problem.** Simulate one replica processing a stream of requests (arrival time, prompt_len, output_len) under (a) static batching and (b) continuous batching, given a fixed batch capacity and a fixed per-step time. Report makespan and mean TTFT.

```python
from dataclasses import dataclass, field
import heapq

@dataclass(order=True)
class Req:
    arrival: float
    prompt_len: int = field(compare=False)
    output_len: int = field(compare=False)
    idx: int = field(compare=False, default=0)
    start: float = field(compare=False, default=-1.0)
    done: float = field(compare=False, default=-1.0)

STEP = 0.02          # 20 ms per decode step
PREFILL_PER_TOK = 0.0002

def continuous_batching(reqs: list[Req], cap: int) -> tuple[float, float]:
    q = sorted(reqs, key=lambda r: r.arrival)
    t, i = 0.0, 0
    running: list[list] = []   # [remaining_out, req]
    ttfts = []
    while i < len(q) or running:
        # admit
        while i < len(q) and q[i].arrival <= t and len(running) < cap:
            r = q[i]; i += 1
            t_prefill = r.prompt_len * PREFILL_PER_TOK
            r.start = t + t_prefill
            ttfts.append(r.start - r.arrival)
            running.append([r.output_len, r])
        if not running:
            t = q[i].arrival; continue
        # one decode step for the whole running batch
        t += STEP
        for slot in running:
            slot[0] -= 1
        for slot in [s for s in running if s[0] <= 0]:
            slot[1].done = t
            running.remove(slot)
    makespan = max(r.done for r in reqs)
    return makespan, sum(ttfts) / len(ttfts)

def static_batching(reqs: list[Req], cap: int) -> tuple[float, float]:
    q = sorted(reqs, key=lambda r: r.arrival)
    t, ttfts, done = 0.0, [], []
    for b in range(0, len(q), cap):
        batch = q[b:b + cap]
        t = max(t, batch[-1].arrival)
        for r in batch:
            r.start = t + r.prompt_len * PREFILL_PER_TOK
            ttfts.append(r.start - r.arrival)
        steps = max(r.output_len for r in batch)          # wait for the slowest
        t += steps * STEP
        for r in batch:
            r.done = t
    return max(r.done for r in q), sum(ttfts) / len(ttfts)
```

*Complexity:* O(total_output_tokens) for continuous (per-step loop), O(n) batches for static. *Optimised:* the point of the exercise is to run both on a workload where `output_len` is drawn from a heavy-tailed distribution and show continuous batching's makespan is far lower and TTFT far more stable — because static batching's `max(output_len)` per batch pins slots idle. Add chunked prefill by capping admitted prefill tokens per step.

### Hard — Tenant-scoped prefix cache (prevent cross-tenant KV reuse)

**Problem.** Implement a prefix-cache key/lookup that shares KV blocks for identical prefixes **only within the same tenant**, and never across tenants — the §2.4 hazard. Support a per-tenant capacity cap so one tenant can't evict another's entries.

```python
import hashlib
from collections import OrderedDict

class TenantScopedPrefixCache:
    def __init__(self, per_tenant_max_entries: int = 1024):
        self.cap = per_tenant_max_entries
        self._store: dict[str, "OrderedDict[str, object]"] = {}   # tenant -> (key -> kv_blocks)

    @staticmethod
    def _key(tenant_id: str, prefix_token_ids: tuple[int, ...]) -> str:
        h = hashlib.sha256()
        h.update(tenant_id.encode("utf-8"))          # tenant is PART OF THE KEY
        h.update(b"\x00")
        h.update(bytes(str(prefix_token_ids), "utf-8"))
        return h.hexdigest()

    def get(self, tenant_id: str, prefix_token_ids: tuple[int, ...]):
        bucket = self._store.get(tenant_id)
        if not bucket:
            return None
        k = self._key(tenant_id, prefix_token_ids)
        if k in bucket:
            bucket.move_to_end(k)                     # LRU touch
            return bucket[k]
        return None

    def put(self, tenant_id: str, prefix_token_ids: tuple[int, ...], kv_blocks) -> None:
        bucket = self._store.setdefault(tenant_id, OrderedDict())
        k = self._key(tenant_id, prefix_token_ids)
        bucket[k] = kv_blocks
        bucket.move_to_end(k)
        while len(bucket) > self.cap:                 # evict only WITHIN this tenant
            bucket.popitem(last=False)

    # test: identical prefix, different tenants -> no sharing
def _selftest():
    c = TenantScopedPrefixCache(per_tenant_max_entries=2)
    prefix = (1, 2, 3, 4, 5)
    c.put("tenant-A", prefix, kv_blocks="A_BLOCKS")
    assert c.get("tenant-A", prefix) == "A_BLOCKS"
    assert c.get("tenant-B", prefix) is None          # <-- the isolation guarantee
    c.put("tenant-B", prefix, kv_blocks="B_BLOCKS")
    assert c.get("tenant-B", prefix) == "B_BLOCKS"
    # tenant-A eviction cannot touch tenant-B
    c.put("tenant-A", (9, 9), "x"); c.put("tenant-A", (8, 8), "y"); c.put("tenant-A", (7, 7), "z")
    assert c.get("tenant-B", prefix) == "B_BLOCKS"
```

*Complexity:* O(1) amortised get/put; O(1) eviction. *Optimised:* for genuinely shared, non-sensitive prefixes (a global system prompt with no tenant data) allow an explicit `shared` namespace that content-only keying is safe for — but the default and the unlabelled case must be tenant-scoped. Add a metric counting cross-tenant *would-have-hit* events (same prefix, different tenant) to quantify how much sharing tenant-scoping costs.

### Expert — Token-aware admission controller with a TTFT SLO and degradation ladder

**Problem.** Build an admission controller for the gateway: given current replica load (outstanding tokens per replica), a per-tenant token-rate quota, and a TTFT SLO, decide for each request: `ADMIT(replica)`, `DEGRADE(fallback_model)`, `QUEUE(deadline)`, or `REJECT`. Enforce that a best-effort tenant can never push an interactive tenant past its SLO.

```python
import time
from dataclasses import dataclass, field

@dataclass
class Replica:
    id: str
    tier: str                      # "interactive" | "batch" | "fallback"
    outstanding_tokens: int = 0
    capacity_tokens: int = 200_000 # KV budget in tokens
    tps: float = 3000.0            # sustained tokens/sec at SLO

@dataclass
class TenantState:
    tenant_id: str
    tier: str
    tokens_per_sec_quota: float
    _bucket: float = field(default=0.0)
    _last: float = field(default_factory=time.monotonic)

    def allow(self, est_tokens: int) -> bool:
        now = time.monotonic()
        self._bucket = min(self.tokens_per_sec_quota,
                           self._bucket + (now - self._last) * self.tokens_per_sec_quota)
        self._last = now
        if self._bucket >= est_tokens:
            self._bucket -= est_tokens
            return True
        return False

@dataclass
class Decision:
    action: str                    # ADMIT | DEGRADE | QUEUE | REJECT
    replica_id: str | None = None
    deadline: float | None = None

def estimate_tokens(prompt_len: int, max_out: int) -> int:
    return prompt_len + max_out

def admit(req_prompt_len: int, req_max_out: int, tenant: TenantState,
          replicas: list[Replica], ttft_slo_s: float) -> Decision:
    est = estimate_tokens(req_prompt_len, req_max_out)

    # 1. quota: over-quota tenants never consume the interactive pool
    over_quota = not tenant.allow(est)

    def eta_ttft(r: Replica) -> float:
        # crude: time for this replica to drain enough to start our prefill
        return r.outstanding_tokens / r.tps

    pool = [r for r in replicas if r.tier == tenant.tier]
    if tenant.tier == "interactive" and not over_quota:
        candidates = sorted((r for r in pool
                             if r.outstanding_tokens + est <= r.capacity_tokens),
                            key=eta_ttft)
        if candidates and eta_ttft(candidates[0]) <= ttft_slo_s:
            candidates[0].outstanding_tokens += est
            return Decision("ADMIT", candidates[0].id)
        # interactive but would breach SLO -> degrade to fallback, don't queue a person
        fb = _least_loaded(replicas, "fallback", est)
        if fb:
            fb.outstanding_tokens += est
            return Decision("DEGRADE", fb.id)
        return Decision("QUEUE", deadline=time.monotonic() + ttft_slo_s)

    # batch / best-effort / over-quota interactive: own pool only, may queue, never interactive pool
    tier = "batch"
    b = _least_loaded(replicas, tier, est)
    if b:
        b.outstanding_tokens += est
        return Decision("ADMIT", b.id)
    if not over_quota:
        return Decision("QUEUE", deadline=time.monotonic() + 30.0)
    return Decision("REJECT")

def _least_loaded(replicas, tier, est):
    pool = [r for r in replicas if r.tier == tier
            and r.outstanding_tokens + est <= r.capacity_tokens]
    return min(pool, key=lambda r: r.outstanding_tokens, default=None)
```

*Complexity:* O(#replicas) per decision. *Optimised:* replace the linear scan with a heap keyed on `outstanding_tokens`; feed real historical output-length percentiles into `estimate_tokens` instead of `max_out` (most requests finish well short of the cap); add hysteresis so a replica hovering at the SLO boundary doesn't flap between ADMIT and DEGRADE; emit per-tenant counters for ADMIT/DEGRADE/QUEUE/REJECT so the degradation and rejection rates are visible to consuming teams (the §E3 lesson). The structural guarantee: the `interactive` pool branch is unreachable for `batch`, best-effort, and over-quota tenants — isolation is enforced by control flow, not by a priority number.

---

## 12. System Design — A Multi-Tenant LLM Inference Platform (Model Gateway + Serving Pools)

*(Four-step Pragmatic Engineer spine.)*

### Step 1 — Understand the problem and establish design scope

**Candidate ↔ interviewer dialogue**

> **Q:** Are we building the inference server itself, or the platform around an existing one?
> **A:** The platform. Assume vLLM (or TensorRT-LLM) as the serving engine. You own the gateway, the pooling, autoscaling, multi-tenancy, and the operational story.
> **Q:** Hosted models, self-hosted, or both?
> **A:** Self-hosted open-weight and fine-tuned models on-prem — the reason the platform exists is data residency. A hosted API is not an option for the in-scope workloads.
> **Q:** How many models, how many tenants?
> **A:** Start with 3 base models (a 70B general, an 8B fast, a fine-tuned extraction model) and ~20 internal teams. Plan for that to grow.
> **Q:** Traffic classes?
> **A:** Interactive (analyst-facing, sub-3s TTFT) and batch (overnight and ad-hoc bulk). They must not interfere.
> **Q:** Scope in: gateway, routing, per-tenant quotas, autoscaling, KV/prefix caching, model registry + eval gate hook, observability, cost governance. Out: training/fine-tuning (Module 183), the eval framework internals (Module 184), the application-layer prompt/agent logic.
> **Q:** Constraints?
> **A:** A fixed annual GPU budget. Residency: all inference in the on-prem region. Market-event bursts up to 10× on the interactive class.

**Functional requirements**

- Accept OpenAI-compatible chat/completions requests (streaming and non-streaming); authenticate; identify tenant and model.
- Route to a healthy replica of the requested model in the correct traffic-class pool, using token-aware load.
- Enforce per-tenant token-rate and concurrency quotas; admit / degrade / queue / reject per policy.
- Serve from semantic cache (Module 165) and use tenant-scoped prefix caching.
- Apply prompt DLP redaction (Module 181) before egress to the model.
- Fall back to a smaller/quantized model tier under saturation, with the degraded response labelled.
- Autoscale replica pools within a budget cap; support scheduled pre-scaling for known events.
- Register models as pinned, hashed, signed artefacts; block deploy of any model/quantization/runtime version that hasn't passed the eval gate.
- Emit per-tenant, per-model, per-pool metrics; support chargeback.

**Non-functional requirements**

- Interactive TTFT p99 ≤ 3 s, TPOT p99 ≤ 60 ms, under normal and pre-scaled burst load.
- Batch class must never degrade interactive SLOs.
- Fail-closed on quota/DLP/eval-gate failures (reject rather than serve ungoverned).
- Residency: no inference egress outside the on-prem region; weights never leave the artefact registry / GPU nodes.
- Budget: hard monthly GPU ceiling; platform sheds to fallback / rejects rather than exceeding it.
- Availability: gateway 99.95%; a single replica or pool loss degrades gracefully, not an outage.

**Back-of-the-envelope estimation**

- 20 teams × ~150k interactive requests/day ≈ 3M/day. Active window 8h ⇒ `3M / 28,800 ≈ 104 req/s` mean, 10× market-event burst ⇒ **~1,000 req/s** peak on interactive.
- Interactive avg ~1,200 input + ~250 output tokens ⇒ ~1,450 tokens/req. Peak token rate ≈ 1,000 × 1,450 ≈ **1.45M tokens/s** at the burst.
- One 70B replica (2×H100) sustains ~3,000 tokens/s at the interactive SLO ⇒ burst needs ~**480 replica-equivalents** of 70B — clearly not affordable, which is the point: the burst must be met by a *mix* — most interactive traffic routed to the 8B fast model (~15,000 tokens/s per GPU), semantic + prefix cache absorbing a large fraction, and a degradation ladder for the rest.
- Batch: ~2B tokens/night over 8h ⇒ ~70k tokens/s sustained ⇒ ~10–15 replicas of the 8B/extraction models at high utilisation.
- KV cache: 70B at 8k ctx ≈ 2.6 GB/req (§2.2) ⇒ a replica holds only a handful of long-context interactive requests — long-context routing and caps are load-bearing, not nice-to-have.
- Cost: steady state ~30–40 GPUs ≈ $90–120k/hr… no — ≈ $90–120/hr ≈ **$65–85k/month**; the warm pool and burst headroom push all-in to ~$110–130k/month.

**What the numbers tell you the hard problem is.** The mean load (~100 req/s) is trivial. The design is dominated by three things: (1) **the 10× interactive burst is unaffordable to meet with the big model** — so the architecture must route aggressively to the small model, lean on caching, and have a real degradation ladder; brute-force capacity is not on the table. (2) **KV cache caps concurrency hard** for the large model — long-context handling (routing, caps, eviction policy) is a first-class concern. (3) **The budget is a hard constraint with a burst requirement attached** — so autoscaling needs a ceiling and a shed-to-fallback policy, and known bursts must be handled by *scheduled* pre-scaling, not reactive autoscaling that can't beat GPU cold start. Throughput is not the problem; **routing, caching, degradation, and cost-bounded elasticity** are.

### Step 2 — Propose a high-level design and get buy-in

**Component glossary**

- **Model Gateway** — stateless request handler: authN/Z, tenant + model resolution, quota enforcement (admit/degrade/queue/reject — Expert exercise), semantic cache lookup, prompt DLP, token-aware routing, streaming pass-through, response labelling (which model/tier served it), OTel emission.
- **Semantic Cache** — Module 165's mechanism: embedding-similarity cache of full responses, tenant- and freshness-scoped.
- **Prefix Cache Service** — tenant-scoped KV-block cache (Hard exercise), consulted by the serving replicas.
- **Serving Pool** — a set of data-parallel replicas of one model at one quantization, tagged with a traffic class (`interactive` / `batch` / `fallback`). Each replica = a vLLM instance, TP-within-node.
- **Pool Autoscaler** — per pool: scales replicas on smoothed leading indicators within a budget ceiling; supports a scheduled pre-scale calendar; maintains a warm standby for interactive pools.
- **Model Registry** — pinned, hashed, signed model artefacts; records the eval-gate result for each (model, quantization, runtime) tuple; deploy is blocked without a PASS.
- **Eval Gate** (hook to Module 184) — runs the model's eval set on any new artefact; emits PASS/FAIL with sliced metrics vs the incumbent baseline.
- **Quota Service** — per-tenant token-rate and concurrency allocations; usage accounting for chargeback.
- **Observability** — per-tenant/model/pool metrics: TTFT/TPOT histograms, throughput, KV utilisation, batch size, prefix/semantic hit rate, degraded-fraction, cost.

**Architecture diagram** — see §3.

**End-to-end walkthrough — one interactive request during a market-event burst**

1. Request arrives at the Gateway; SSO token → tenant `T`, requested model `general-70b`.
2. Gateway checks the **semantic cache** (scoped to `T` + freshness); on hit, stream the cached response, label `served-by: cache`, done.
3. Miss. **Prompt DLP** redacts any secret/PAN-shaped content.
4. **Quota check** (Expert exercise): `T` is within quota. But the burst policy for market events routes `general-70b` interactive traffic to `fast-8b` unless the tenant is on a "premium quality" list — `T` is not, so the effective model becomes `fast-8b`.
5. **Token-aware routing**: pick the `fast-8b` interactive replica with the lowest outstanding-token load whose projected TTFT ≤ 3 s.
6. If no interactive replica can meet the SLO: **degrade** to the `fallback` pool (INT4 `fast-8b`), label the response `served-by: fast-8b-int4-fallback`, and increment the degraded-fraction metric visible to `T`.
7. The chosen replica checks the **tenant-scoped prefix cache** for the shared instruction+context prefix; on hit, prefill cost for that prefix is skipped.
8. Replica runs prefill (chunked) then decode under continuous batching; tokens stream back through the Gateway to the client.
9. Gateway records: tenant, model actually used, tokens in/out, TTFT/TPOT, cache hits, degraded flag → OTel + Quota Service (usage) + chargeback.
10. Meanwhile the **Autoscaler** for the `fast-8b` interactive pool, which was **pre-scaled on the market-event calendar** 20 minutes before the release, is holding at burst capacity; it will scale down on a long cooldown after the window.

**REST API (gateway, OpenAI-compatible + admin)**

`POST /v1/chat/completions`
| Field | Type | Description |
|---|---|---|
| `model` | string | Logical model name; gateway maps to a pool (and may remap under burst policy) |
| `messages` | object[] | Standard chat messages |
| `stream` | bool | SSE streaming |
| `max_tokens` | int | **Capped server-side** at the pool's ceiling regardless of request value |
| (header) `Authorization` | string | SSO/service token → tenant |
| (header) `X-Priority` | enum | `interactive` \| `batch` — informs class routing; does not override quota |

Response adds headers: `X-Served-By` (pool/model/quantization actually used), `X-Degraded` (bool), `X-Cache` (`semantic` \| `prefix-partial` \| `miss`).

`GET /v1/models` — logical models available to the caller's tenant.
`POST /admin/v1/models` (platform-admin) — register an artefact `{name, uri, sha256, signature, quantization, runtime_version}`; returns `409` unless an Eval-Gate PASS exists for the tuple.
`PUT /admin/v1/quota/{tenant}` — set `{tokens_per_sec, max_concurrency, premium_quality: bool}`.
`POST /admin/v1/prescale` — `{pool, target_replicas, start_at, end_at}` for a known event.

**Data model**

`serving_pool`
| Column | Type | Description |
|---|---|---|
| `id` | text PK | e.g. `fast-8b-interactive` |
| `model_artifact_sha` | text | FK to `model_artifact`; what's deployed |
| `traffic_class` | text | `interactive` \| `batch` \| `fallback` |
| `min_replicas` / `max_replicas` | int | Autoscaler floor/ceiling (ceiling = budget) |
| `warm_standby` | int | Pre-loaded idle replicas |
| `tp_degree` | int | Tensor-parallel size |

`model_artifact`
| Column | Type | Description |
|---|---|---|
| `sha256` | text PK | Immutable artefact hash |
| `name` / `base_model` | text | |
| `quantization` | text | `fp16` \| `fp8` \| `int8-w` \| `int4` |
| `runtime_version` | text | Serving-engine version |
| `eval_gate_state` | text | `PENDING → PASS \| FAIL` |
| `eval_report_uri` | text | Sliced metrics vs baseline |
| `signature` | text | Supply-chain signature |

`tenant_quota`
| Column | Type | Description |
|---|---|---|
| `tenant_id` | text PK | |
| `tokens_per_sec` | int | Token-bucket rate |
| `max_concurrency` | int | Concurrent requests |
| `premium_quality` | bool | Exempt from burst downgrade to the small model |
| `monthly_token_budget` | bigint | Chargeback / soft cap |

`request_log` (append-only, sampled or full per retention policy)
| Column | Type | Description |
|---|---|---|
| `id` | bigint PK | |
| `ts` | timestamptz | |
| `tenant_id` / `logical_model` / `served_pool` | text | Requested vs actually served |
| `in_tokens` / `out_tokens` | int | |
| `ttft_ms` / `tpot_ms_p50` | int | |
| `degraded` | bool | |
| `cache` | text | `semantic` \| `prefix` \| `miss` |

**Status lifecycles**

- Model artefact: `PENDING → PASS → DEPLOYED → RETIRED` (or `PENDING → FAIL`, never deployable).
- Replica: `PROVISIONING → LOADING_WEIGHTS → WARM → IN_ROTATION → DRAINING → TERMINATED`.
- Request admission: `RECEIVED → (ADMITTED | DEGRADED | QUEUED → ADMITTED/EXPIRED | REJECTED) → STREAMING → DONE/ERROR`.

**Modelling rationale (inline).** The gateway is **stateless** so it scales trivially and is never the capacity constraint. `request_log` is **append-only** and the source of truth for chargeback and efficiency trending (§E4) — it must record the model *actually served*, not just requested, or the degraded-fraction and cost-attribution metrics are wrong. `model_artifact` is keyed by **hash** and carries the **eval-gate state as a column**, so "is this deployable" is a single indexed lookup and a FAIL artefact is structurally undeployable. Quota is its **own table** with `premium_quality` as an explicit flag because the burst-downgrade policy needs a fast per-tenant decision on the hot path. Pools are **first-class rows with a traffic class**, not a tag on replicas, because class isolation is enforced by routing to a pool, and the autoscaler's budget ceiling lives at the pool level.

### Step 3 — Design deep dive

**Traffic-class isolation.** Interactive and batch pools are physically separate replica sets. The gateway routes by `traffic_class` derived from the token/priority header *and* tenant tier; a batch or over-quota request is structurally unable to be routed to an interactive replica (Expert exercise control-flow guarantee). Batch has its own autoscaler and its own budget slice. This is the Module 180 "separate lanes, not a priority field" principle applied to GPUs.

**Cost-bounded autoscaling.** Per pool: `min_replicas` (baseline), `max_replicas` (the budget ceiling — the autoscaler cannot exceed it). Scale-up signal: EWMA of arrival rate + TTFT p95 trend; scale-down: long cooldown (20 min) with hysteresis. A `warm_standby` count keeps N replicas pre-loaded (weights resident, out of rotation) so a real scale-up is ~20 s. **Scheduled pre-scaling**: a calendar of known market events drives the pool to a target well before the event; reactive autoscaling is the backstop, not the primary mechanism, because GPU cold start (~4–5 min) exceeds burst onset. When `max_replicas` is hit and load still exceeds capacity, the gateway's admission controller shifts to degrade/queue/reject — the platform never exceeds budget to meet load.

**Long-context handling.** Requests above a context threshold are (a) capped at `max_model_len`, (b) routed to a dedicated long-context sub-pool with a smaller `max_num_seqs` (so their KV cache doesn't evict everyone on a general replica), and (c) counted against a stricter per-tenant long-context quota. Eviction policy under KV pressure: evict the newest low-priority request's KV cache and mark it for recompute-on-resume rather than failing it.

**Caching layers and their scoping.** Semantic cache (full response, embedding-similarity) keyed on `tenant + normalized_prompt + freshness_bucket`. Prefix cache (KV blocks) keyed on `tenant + prefix_token_ids` (Hard exercise) — a global `shared` namespace exists only for an explicitly non-sensitive, platform-owned system prompt. Both emit hit-rate metrics; a falling prefix hit rate is an efficiency-drift signal (§E4).

**Model onboarding / eval gate.** A new artefact (new model, new quantization, new runtime version) lands in the registry as `PENDING`. The Eval Gate (Module 184) runs its eval set, produces sliced metrics vs the current `DEPLOYED` artefact as baseline, and sets `PASS`/`FAIL` with a report. Only `PASS` artefacts can be attached to a pool. Rollout to a pool is canary → progressive with automated rollback on TTFT/TPOT/error regression. The old artefact stays `DEPLOYED`-capable for fast rollback. This makes "someone shipped an unvalidated quantization" structurally impossible (the §A3 / §E-quantization concern).

**Degradation, labelled and attributed.** Every response carries `X-Served-By` and `X-Degraded`. The degraded-fraction metric is per-tenant and exposed on the tenant's own dashboard. Consumer contracts declare per-use-case whether degradation is acceptable or the request must **fail closed** (a numeric extraction feeding a regulatory report errors rather than silently downgrading — §E3). After any degradation window, an event with the time range is published so affected consumers can re-process.

**Residency & weight protection.** All pools run in the on-prem region; the gateway rejects any config that would route inference elsewhere. Weights live encrypted in the artefact registry, pulled JIT to GPU nodes, never on shared or developer storage; the serving subnet's egress is deny-by-default (no path to copy weights out); artefacts are signed and hash-pinned (§A6).

**Consistency.** The serving path is stateless/AP. The **model registry and eval-gate state** are CP — deploying a FAIL or unvalidated artefact is worse than a slow deploy, so the registry is the authority and the gateway reads it strongly. Quota accounting is eventually consistent (token buckets are local with periodic reconciliation) — a small over-serve on a quota edge is acceptable; a hard concurrency cap is enforced locally per gateway instance with a global ceiling reconciled.

**Failure handling.** Replica loss: the pool autoscaler replaces it; the gateway routes around it immediately (health checks + circuit breaking). Whole-pool loss: the gateway degrades that model's traffic to the fallback pool and pages. Gateway instance loss: stateless, load-balanced, no impact. Eval Gate unavailable: model onboarding blocks (fail-closed), serving unaffected. Budget ceiling reached mid-burst: admission controller degrades/queues/rejects with a clear error and a metric; a page fires so a human can make a capacity/budget call.

### Step 4 — Wrap-up

**Not covered, and the next questions:**
- Fine-tuning / distillation pipeline that *produces* the custom artefacts (Module 183).
- The eval framework internals — dataset curation, LLM-as-judge, statistical gates (Module 184).
- Multi-region active-active for DR and cross-domicile routing.
- Disaggregated prefill/decode serving if interactive TPOT SLOs tighten.
- GPU procurement / reserved-capacity contracts and the on-prem-vs-hybrid revisit cadence (§E1).
- Chargeback pricing model and how teams are billed for degraded vs full-quality service.
- Speculative decoding for the latency-critical low-batch paths.

**Summary.** A stateless model gateway doing auth, quota, caching, DLP, token-aware routing, and labelled degradation, in front of physically-isolated per-traffic-class serving pools of a purpose-built inference engine (continuous batching, paged + tenant-scoped-prefix KV cache), with cost-bounded autoscaling backed by scheduled pre-scaling and warm pools, and a hash-pinned model registry gated by an eval check. The mean load is trivial; the platform's entire difficulty is meeting an unaffordable burst through routing + caching + a degradation ladder, handling KV-cache-capped concurrency, and never spending past a fixed budget to do it.

### References

1. Kwon et al., *Efficient Memory Management for Large Language Model Serving with PagedAttention* (vLLM), SOSP 2023.
2. Yu et al., *Orca: A Distributed Serving System for Transformer-Based Generative Models* (continuous / iteration-level batching), OSDI 2022.
3. vLLM documentation — scheduler, chunked prefill, prefix caching, quantization support.
4. NVIDIA — *TensorRT-LLM* documentation; in-flight batching; FP8 and INT4 (AWQ/GPTQ) support.
5. Dettmers & Zettlemoyer — *The case for 4-bit precision*; Frantar et al., *GPTQ*; Lin et al., *AWQ*; Xiao et al., *SmoothQuant*.
6. Leviathan et al., *Fast Inference from Transformers via Speculative Decoding*, ICML 2023; Cai et al., *Medusa*; Li et al., *EAGLE*.
7. Pope et al., *Efficiently Scaling Transformer Inference* (TP/PP trade-offs, roofline for inference), MLSys 2023.
8. Zhong et al., *DistServe: Disaggregating Prefill and Decoding for Goodput-Optimized LLM Serving*, OSDI 2024.
9. Agrawal et al., *SARATHI / Taming Throughput-Latency Tradeoff* (chunked prefill), 2023–24.
10. Ainslie et al., *GQA: Training Generalized Multi-Query Transformer Models*, 2023.
11. NVIDIA — Multi-Instance GPU (MIG) and GPU scheduling docs; Kubernetes device plugin / KServe / Ray Serve autoscaling guidance.
12. *System Design Interview Vol. 2*, Alex Xu & Sahn Lam — payment-system chapter (four-step structure).
13. Module 162 (LLM Fundamentals), Module 165 (LLM Integration), Module 180 (Notification & Alerting — priority-lane argument), Module 184 (AI Evaluation — the eval gate) — this course.

---

## 13. Low-Level Design

**Requirements.** Route a request to the right replica under quota and SLO; enforce traffic-class isolation; manage paged + tenant-scoped KV cache; gate model deploys on an eval PASS; degrade with attribution.

**Class diagram (textual)**

```
ModelGateway
 ├─ authenticate(req) -> TenantCtx
 ├─ resolveModel(logical, tenant, burstPolicy) -> PoolRef
 ├─ semanticCache: SemanticCache            # Module 165
 ├─ dlp: PromptDlp                          # Module 181
 ├─ admission: AdmissionController          # Expert exercise
 ├─ router: TokenAwareRouter
 └─ handle(req) -> StreamedResponse (+ X-Served-By / X-Degraded / X-Cache)

AdmissionController
 ├─ quota: QuotaService                     # token buckets, per tenant
 ├─ decide(req, poolLoad) -> ADMIT|DEGRADE|QUEUE|REJECT
 └─ (interactive pool branch unreachable for batch/over-quota — control-flow isolation)

TokenAwareRouter
 └─ pick(pool) -> Replica  (min outstanding_tokens with projected TTFT <= SLO)

ServingPool
 ├─ trafficClass: INTERACTIVE|BATCH|FALLBACK
 ├─ replicas: List<Replica>
 ├─ autoscaler: PoolAutoscaler             # leading signal + budget ceiling + warm pool + prescale calendar
 └─ modelArtifactSha

Replica (wraps a vLLM instance)
 ├─ scheduler: ContinuousBatchScheduler    # Medium exercise
 ├─ kv: PagedKVCache
 ├─ prefixCache: TenantScopedPrefixCache   # Hard exercise
 └─ outstandingTokens: int

ModelRegistry
 ├─ register(artifact) -> requires EvalGate PASS
 ├─ evalGate: EvalGateClient               # Module 184
 └─ deployable(sha) -> bool
```

**Sequence diagram** — see §3 and the §12 walkthrough.

**Design patterns used.** Facade (ModelGateway); Strategy (routing policy, burst-remap policy, quantization); Chain of Responsibility (admission: quota → SLO check → degrade → queue → reject); Circuit Breaker (per-replica health, per-pool fallback); Object Pool (warm standby replicas); Template Method (autoscaler: fixed loop, pluggable signal); Proxy (gateway in front of the serving engine).

**SOLID mapping.** *SRP* — routing, admission, caching, autoscaling, registry each isolated. *OCP* — new quantization types, new traffic classes, new routing signals added without touching the gateway core. *LSP* — `interactive`/`batch`/`fallback` pools are interchangeable behind `ServingPool`; vLLM/TensorRT-LLM interchangeable behind `Replica`. *DIP* — the gateway depends on `EvalGateClient`, `QuotaService`, `PromptDlp` abstractions, reusing the firm's existing eval, quota, and DLP infrastructure rather than reimplementing.

**Extensibility.** A new model = a new artefact + eval PASS + a pool; no code change. A new traffic class (e.g. `realtime-fraud`) = a new enum value, a pool, and a routing rule. Disaggregated serving slots in behind `Replica` as a composite of a prefill pool + decode pool.

**Concurrency / thread safety.** The gateway is stateless per request; quota token buckets are per-tenant, per-gateway-instance with atomic refill/consume and periodic global reconciliation. `outstandingTokens` per replica is updated atomically on admit and on stream completion; the router reads a consistent snapshot. The continuous-batch scheduler is single-threaded per replica (the GPU is the serial resource) with a lock-free intake queue. Prefix-cache eviction is per-tenant-bucket-locked so one tenant's churn can't corrupt another's. Autoscaler actions take a per-pool advisory lock so two controllers can't double-scale.

---

## 14. Production Debugging

**Incident.** Six weeks after the §4 fixes, the interactive `general-70b` pool starts throwing `CUDA out of memory` on ~2% of requests during afternoon peak. Not a burst — steady-state load, well within provisioned capacity. p50 latency is normal; the failures are a jagged 2%.

**Root cause.** A team had rolled out a new RAG feature that retrieves and stuffs up to **24k tokens** of context per request. These long-context requests were a small fraction of volume but each held a ~7.7 GB KV cache. The continuous-batch scheduler, admitting requests greedily up to `max_num_seqs`, would occasionally pack several long-context requests into the same batch; their combined KV cache plus the running short requests exceeded the paged pool, and the eviction path — which was configured to *swap to CPU* — hit a bug in the version of the serving engine where the swap-back on resume raced with new admissions, leaving the block table inconsistent and the next allocation failing hard with OOM instead of gracefully evicting. p50 was fine because 98% of batches never contained enough long-context requests to trigger it.

**Investigation.**
- OTel showed `kv_cache_utilization` spiking to ~100% right before each OOM cluster, correlated with `num_long_context_requests_in_batch >= 3`.
- The request log (§12 data model) sliced by `in_tokens` showed the OOM requests were overwhelmingly the ones in the 20k–24k input band, and that band had appeared six weeks earlier — matching the RAG feature's release.
- Reproduced by replaying a trace with the real long-context fraction and `max_num_seqs` unchanged; OOM reproduced at ~2%.

**Fix.**
1. **Immediate**: cap `max_model_len` at 16k on the general pool and route >16k-context requests to a dedicated **long-context sub-pool** with `max_num_seqs` set low (so a batch there can hold 4 long requests safely, not contend with short traffic).
2. **Scheduler**: add a KV-budget-aware admission check — don't admit a request whose *projected* KV cache (from its input length + `max_tokens`) would push the batch over a safe fraction of the paged pool; queue it instead.
3. **Eviction**: switch from CPU-swap to recompute-on-resume (slower per event, but no block-table race) and upgrade the serving engine past the swap bug.
4. **Guardrail**: a per-tenant long-context token quota so a single team's feature can't grow unbounded context usage without a conversation.
5. **Alert**: on `kv_cache_utilization` p95 trend and on `num_long_context_requests_in_batch`, before OOM.

**Prevention.**
- **KV-cache capacity is a function of the input-length *distribution*, not the mean** — a small tail of long-context requests can co-schedule and blow the pool. Admission must reason about projected KV budget, not just request count.
- **A downstream team's feature change (bigger RAG context) silently changed the serving platform's memory profile.** Per-tenant context quotas and a slice-by-input-length view make that visible before it's an incident.
- **"Graceful eviction" is only graceful if the eviction path is actually correct** — a swap-back race turned a soft limit into a hard crash. Test the eviction path under real pressure, not just the happy path.
- Same shape as §4: the platform was built correctly; it broke on an operational property (KV budget vs input-length tail) that no functional test covered.

---

## 15. Architecture Decision

**Decision.** For the firm's highest-volume interactive workload (document Q&A over a policy corpus, ~800M tokens/day, residency-constrained), how should it be served: (A) hosted API in-region, (B) self-host the 70B model at FP16, (C) self-host the 70B at FP8, (D) self-host an 8B fine-tune + FP8 with 70B fallback for hard queries?

**Option A — Hosted API, in-region endpoint (if one exists that meets residency).**
*Advantages:* zero GPU ops, elastic, no cold-start problem, pay per token; fastest to ship.
*Disadvantages:* residency may not be satisfiable (depends on provider region coverage / contractual terms); per-token cost at 800M/day × 30 is material (~$25–70k/month depending on price); shared capacity / rate limits during market events; no path to a custom model.
*Cost:* medium-high opex, ~zero capex, ~zero ops. *Risk:* residency compliance is the gating question; if it passes, low technical risk.

**Option B — Self-host 70B FP16.**
*Advantages:* full residency control; reference quality; predictable capacity.
*Disadvantages:* ~140 GB weights ⇒ 2 GPUs/replica before KV; poor tokens/$; KV-cache-capped concurrency; you own cold-start, autoscaling, on-call.
*Cost:* high capex/opex; worst tokens/$ of the self-host options. *Risk:* medium — mostly operational; over-provisioned to hit SLOs.

**Option C — Self-host 70B FP8.**
*Advantages:* residency control; ~half the weight memory and lower TPOT vs FP16; quality typically within noise on Q&A after an eval check; better tokens/$ than B; fits on fewer GPUs, more KV room.
*Disadvantages:* still a 70B — expensive per token vs a small model; requires the eval-gate discipline; FP8 needs supported hardware.
*Cost:* medium-high, notably better than B. *Risk:* low-medium, contingent on the eval-set regression check passing (it usually does for retrieval-grounded Q&A).

**Option D — 8B fine-tune (FP8) as the workhorse + 70B FP8 fallback for hard/low-confidence queries (recommended).**
*Advantages:* the 8B handles the large majority of grounded-Q&A traffic at ~5–10× the tokens/$ of the 70B and easily meets the TTFT SLO; a confidence/complexity router sends the hard minority to the 70B pool; residency fully controlled; the fine-tune (Module 183) closes most of the quality gap on *this* task specifically; burst behaviour is far cheaper because the workhorse is small.
*Disadvantages:* you now run and evaluate two models and a router; the fine-tune needs a training pipeline and its own eval + drift monitoring; router mistakes send a hard query to the small model (mitigated by a confidence threshold tuned on the eval set).
*Cost:* medium capex (training + two pools), best steady-state tokens/$ by a wide margin. *Risk:* medium — concentrated in the router quality and the fine-tune's eval; both are measurable and gate-able.

**Recommendation — Option D, with Option C's 70B FP8 as the fallback tier.**
The workload is narrow (grounded Q&A over one corpus) and high-volume — exactly the shape where a task-specific small model plus a big-model fallback dominates a single big model on cost while holding quality, provided the eval gate (Module 184) and a tuned confidence router are in place. Option A is the answer *only* if an in-region hosted endpoint contractually satisfies residency and the per-token economics beat D at this volume — worth a bake-off, but residency usually forces self-host here. Option B is never the right long-term choice once FP8 is validated. The decision hinges on two measurable things: the 8B fine-tune's eval score vs the 70B on this corpus, and the router's precision at sending hard queries up — both gate the rollout and both are re-checked on every model change.

---

## 17. Principal Engineer Perspective

**Business impact.** Inference infrastructure is the line item that turns a promising AI feature into a sustainable one or a money pit. A tuned platform serves the same workload at a fraction of the cost and with SLOs the business can commit to customers; an untuned one is a surprise invoice and an outage during the market event when it's most visible. The Principal's job is to make served-work-per-dollar-at-SLO a tracked, improving number.

**Engineering trade-offs.** Every lever here is a trade: batch size (throughput vs TPOT), quantization (cost vs accuracy), TP degree (fit vs per-layer latency), warm pools (idle cost vs scale-up speed), reserved capacity (spend vs burst survival), small-model routing (cost vs quality on the hard tail). None has a default; each is a measured decision with a named cost, revisited as models, hardware, and traffic change.

**Technical leadership.** The recurring failure shape in this module is a platform that is *functionally* correct but fails on an *operational property* no functional test exercises — "autoscaled" when scale latency exceeds the burst (§4), KV capacity sized to the mean when the long-context tail co-schedules (§14), degradation that works but is invisible and unattributed (§E3). A Principal institutionalises testing the operational envelope: replay real traces with real distributions, load-test against the burst profile, test the eviction and degradation paths under pressure, and state elasticity as a time constant, not a boolean.

**Cross-team communication.** The platform is shared infrastructure; its failure modes are driven by consumer behaviour (a team's RAG feature triples context length; a team launches a batch job at 2 p.m.). The controls are per-tenant quotas, chargeback, slice-by-tenant observability, and consumer contracts that state which use cases may accept degraded output and which must fail closed. The Principal runs the forum where model onboarding, quota changes, and the on-prem-vs-hybrid question are decided with data.

**Architecture governance.** Standing governed artefacts: the model registry with its eval-gate requirement (no unvalidated model or quantization reaches production), the quantization policy, the traffic-class isolation rule, the per-tenant quota table, the degradation ladder and its fail-closed exceptions, the market-event pre-scale calendar. Reviewed jointly by the platform team and the model-risk / security function.

**Cost optimisation.** The lever order under a fixed budget (§E5): free wins first (routing, caps, caching, killing low-utilisation pools, off-peak batch), then near-free (FP8/INT8 gated on eval), then trade-offs (lower TPOT SLO, degradation, quota-based shedding), then structural (small/distilled model for part of the traffic — Module 183, hybrid burst to a hosted endpoint), and only then buy GPUs — with utilisation and tokens/$ evidence. Demand governance (quotas + chargeback so teams internalise cost) is as important as any infra optimisation.

**Risk analysis.** The dominant risks are: a governance gap (an unvalidated quantization shipped — closed by the eval gate being structural), silent degradation (closed by labelling + fail-closed contracts + reconciliation), capacity that isn't there when needed (closed by reserved baseline + warm pools + scheduled pre-scaling + a modelled burst), cross-tenant leakage via caches (closed by tenant-scoped keys), and GPU supply/budget shock (closed by a hybrid exit path and a hard autoscaler ceiling with shed-to-fallback). All are operational/governance risks, not model-quality risks.

**Long-term maintainability.** Efficiency drifts — batch sizes shrink as contexts grow, prefix hit rates fall as prompts proliferate, utilisation sags as pools fragment, the degraded fraction creeps up. The platform stays healthy only if tokens/$/SLO, utilisation, and the cache/degradation/quota metrics are *trended* per model and per pool and reviewed on a cadence — the same "verify the verifier, detect by trend and by absence" discipline this course applies at every layer, here pointed at the economics of the hardware.

---

**Next in this run:** Module 183 — Model Adaptation: Fine-Tuning, LoRA/PEFT, Distillation & the Prompt-vs-RAG-vs-Tune Decision, which produces the custom artefacts (the 8B fine-tune in §15's recommendation) that this module assumed as an input and serves.
