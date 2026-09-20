# AI Systems (LLM / RAG / Agents / MLOps) — Cram Sheet

> Tier 2 · Source: `44-AI-Systems/` (12 modules, 9,468 lines) · Read: 18 min
> Increasingly asked at Principal/Architect level. **Frame every answer as a systems problem**, not an ML-research one.

---

## 1. LLM Fundamentals

- **Self-attention is O(n²) in sequence length** — that is *why* context length is expensive and why long context costs more than linearly.
- **Two latency phases, and they have different bottlenecks:**
  - **Prefill** — process the whole prompt in parallel. **Compute-bound.** Determines *time-to-first-token*.
  - **Decode** — generate one token at a time, autoregressively. **Memory-bandwidth-bound.** Determines *tokens/second*.
  - **KV cache** stores past keys/values so each new token doesn't re-read history — and it is **the real memory constraint** at serving time (it grows with batch × sequence length).
- **Tokens ≠ words** (~0.75 words/token in English; far worse for code, JSON and non-Latin scripts). **You are billed and context-limited in tokens** — budget in tokens.
- **Temperature/sampling:** 0 = greedy. **Even at temperature 0 output is not guaranteed deterministic** — batching, floating-point non-associativity on GPUs and model updates all introduce variance. Never build an exact-match test on that assumption.
- **"Lost in the middle"** — retrieval accuracy is highest at the start and end of a long context and degrades in the middle. Put the critical content at the boundaries; a bigger context window is not a substitute for good retrieval.
- **Hallucination is a structural property, not a bug** — the model predicts plausible continuations; it has no notion of truth. You can *reduce* it (grounding, citations, constrained output, retrieval) but never eliminate it. **Design the system so a hallucination is caught, not so it never happens.**

---

## 2. Prompt Engineering

- **Few-shot: example *selection* matters more than example *count*.** Examples close to the actual input, and covering the edge cases you care about, beat more generic ones.
- **Chain-of-thought** buys real accuracy on reasoning tasks and **costs real tokens and latency**. Use it where the task is genuinely multi-step; not by default.
- **Structured output is the structural fix** — JSON mode / constrained decoding / tool schemas, so you get a parseable contract instead of parsing prose with a regex. **Validate against a schema anyway.**
- **Prompt testing is property-based, not exact-match:** assert invariants (valid JSON, contains a citation, never names a competitor, refuses out-of-scope, within a length bound) — not string equality.
- **Prompt injection — defence in depth**, because there is no single fix:
  - separate instruction and data channels; treat all retrieved/user content as **untrusted data**;
  - **least privilege on tools** — the model cannot misuse a capability it doesn't have;
  - output filtering and schema validation;
  - human approval for irreversible actions.
- **Indirect prompt injection** is the serious one: malicious instructions inside a *retrieved document*, a web page or an email the model reads. **Retrieved content is a trust boundary** — this is the point most candidates miss.

---

## 3. RAG

- **Pipeline:** ingest → chunk → embed → index → **retrieve (hybrid) → rerank → build prompt → generate with citations**.
- **Chunking is the highest-leverage knob.** Too small loses context; too large dilutes the embedding and wastes the window. Start ~200–500 tokens with overlap, but **chunk on structure** (headings, sections, function boundaries) rather than a fixed character count.
- **Embeddings assume semantic similarity ≈ relevance**, which fails for exact identifiers, product codes, names and negation. **Hence hybrid search: dense (semantic) + sparse (BM25/keyword), fused with Reciprocal Rank Fusion, then a cross-encoder reranker.** "Just use a vector DB" is an incomplete answer.
- **ANN indexes:** HNSW (graph, fast, memory-hungry) · IVF-PQ (quantised, compact, less accurate). This is the **same recall/latency/memory trade** as any storage engine.
- **Evaluation — and the ground-truth problem:** you need a labelled set of query→relevant-document pairs to measure retrieval **precision/recall@k**, and almost nobody has one. Build a golden set (a few hundred curated examples) — it is the single most valuable artifact in a RAG project.
- **Measure retrieval and generation separately.** If the answer is wrong, was the right chunk retrieved at all? Most RAG failures are retrieval failures.
- **Grounding:** instruct the model to answer *only* from the provided context, to cite chunk ids, and to say "I don't know" — then **verify the citations actually support the claim.**

---

## 4. LLM Integration (production patterns)

- **Function/tool calling is a two-round-trip protocol**, not one call: model returns a tool-call request → *your code* executes it → you send the result back → model produces the final answer. **The model never executes anything** — that's your trust boundary, and where authorisation belongs.
- **Semantic caching** — cache by embedding similarity, not exact string match. Big cost win, **and a real hazard: a near-miss returns a subtly wrong answer.** Scope cache keys carefully (per tenant, per user, per permission set) or you leak across boundaries.
- **Streaming** through a multi-hop system (SSE) — every hop (gateway, proxy, LB) must not buffer, and you must handle an error that occurs *after* streaming began (you already sent a 200).
- **Multi-provider resilience** — failover is easy, **output consistency is not**: a different model produces different formatting, different refusals and different quality. Pin your prompts and evals per provider.
- **Cost governance: the multiplicative request chain.** One user request → agent loop × N steps × retries × reranking × a judge = 50 model calls. **Budget per request, cap the loop, and meter per tenant.**

---

## 5. AI Agents

- **The plan–act–observe loop is structurally a saga:** multi-step, non-transactional, side-effecting, needing compensation. Treat it with the same discipline — idempotency, timeouts, state persistence, compensating actions.
- **Compounding failure surface:** an N-step agent inherits every single-step risk **N times**. 95% per-step reliability over 10 steps = **~60% end-to-end.** State this number; it is the argument for short loops and checkpoints.
- **Architectures:** orchestrator–worker (a coordinator delegates; visible, controllable) vs peer-to-peer (emergent, hard to debug). **Prefer orchestrator–worker** — same reasoning as orchestration vs choreography.
- **Memory:** short-term (the context window) · long-term (a vector store) · working state (explicit, external). **Summarisation loses information silently** — the failure nobody detects.
- **Autonomy risk — calibrate human-in-the-loop by reversibility and blast radius:** read-only → autonomous; reversible writes → autonomous with an audit log; **irreversible or money-moving → human approval, always.** Bound the loop (max steps, max spend, max wall-clock) and make every tool call auditable.

---

## 6. MCP (Model Context Protocol)

- **Client–Host–Server architecture** — the N×M → N+M integration argument, same as an identity broker or an ESB.
- **Primitives:** **Tools** (model-invoked, side-effecting) · **Resources** (application-controlled, read-only data) · **Prompts** (user-invoked templates). That split is itself **risk tiering**.
- **The genuinely new contribution is the third-party trust boundary** — you are loading tool definitions from a server you don't control.
- **Tool poisoning / "rug pull":** a server's tool *description* is fed to the model, so a malicious or later-updated description is an **indirect injection vector**. Pin server versions, review tool definitions, and monitor for changes.

---

## 7. Serving Infrastructure

- **Continuous (iteration-level) batching** beats static batching — new requests join the batch at each decode step instead of waiting for the slowest in the batch. This is the single biggest throughput lever (vLLM).
- **PagedAttention** — treats KV cache like virtual memory pages, eliminating fragmentation; **prefix caching** reuses the KV of a shared prompt prefix (big win for a common system prompt).
- **Quantization** (FP16 → INT8/INT4, AWQ/GPTQ) — less memory and higher throughput for a measurable quality cost. **Always evaluate the quantised model, never assume parity.**
- **Parallelism:** tensor (split layers across GPUs, needs fast interconnect) · pipeline (split by layer stage) · expert (MoE).
- **Speculative decoding** — a small draft model proposes tokens, the big model verifies in one pass. Same output distribution, lower latency.
- **Prefill/decode disaggregation** — run the compute-bound and bandwidth-bound phases on separately-sized pools.

---

## 8. Model Adaptation — prompt vs RAG vs fine-tune

| Need | Use |
|---|---|
| Behaviour/format/style | **prompt** (then few-shot) |
| Current, private, citable **facts** | **RAG** |
| A consistent *skill*, tone, or a narrow task done cheaply | **fine-tune** |
| Cheaper/faster inference at similar quality | **distillation** |

- **Fine-tuning does not reliably add facts** — it shapes behaviour. Using it as a knowledge store is the classic wrong answer; RAG is how you add facts.
- **Catastrophic forgetting** — full fine-tuning degrades general capability. **LoRA/QLoRA (PEFT)** trains small adapter matrices instead: ~0.1% of the parameters, cheap, swappable per tenant, and far less forgetting.
- **SFT: the data *is* the model** — a few thousand high-quality, consistent examples beat a hundred thousand noisy ones.
- **Preference tuning (RLHF / DPO)** — for subjective quality where you can express "A is better than B" but not write the target. DPO is far simpler than RLHF; reach for it only after SFT has plateaued.

---

## 9. Evaluation & MLOps

- **Build a golden eval set that reflects real traffic, including the hard and adversarial cases.** Without it you cannot ship a prompt change safely.
- **LLM-as-judge is the workhorse** — and has real failure modes: position bias, verbosity bias, self-preference, and poor calibration. Mitigate with pairwise comparison, randomised order, a rubric, and periodic human agreement checks.
- **Generative metrics are noisy** — a 2% difference on 100 examples is not a result. Use enough samples and report confidence intervals.
- **CI regression gates** — eval in the pipeline with thresholds, plus a flakiness budget so the gate is trusted.
- **Online:** A/B testing, and **interleaving** for ranking-style changes.
- **MLOps:** feature store (prevents **training–serving skew**) · model registry with staged promotion · **drift monitoring** (input drift is observable immediately; outcome drift waits for **label lag**, which in credit or fraud can be months) · champion/challenger and shadow deployment.
- **Model Risk Management (SR 11-7)** — the regulated-finance frame: independent validation, **"effective challenge,"** documented model inventory, and **explainability for any decision affecting a customer** (credit, fraud, pricing). A model you cannot explain is not deployable in these firms.

---

## Top traps

1. Fine-tuning proposed to add knowledge (use RAG).
2. Pure vector search with no keyword/hybrid and no reranker.
3. Assuming temperature 0 means deterministic.
4. Retrieved content trusted as instructions (indirect injection).
5. Tools granted broad permissions "so the agent can work."
6. No golden eval set → no safe way to change a prompt.
7. Ignoring the N-step compounding reliability maths.
8. Semantic cache without tenant/permission scoping.
9. Exact-match prompt tests.
10. No cost cap on an agent loop.

---

## Interview Q&A — Lead / Principal

### Q1 · Putting an LLM in a regulated workflow *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"The business wants an LLM to answer customer queries about their accounts. What's your position?"*

**Answer.** Feasible, with the architecture determined by one question: **what happens when it's wrong?** Hallucination is a structural property of the model, not a bug to be fixed — it predicts plausible continuations and has no notion of truth — so the design has to make a wrong answer *caught*, not impossible.

That drives a tiered approach by consequence. **Read-only, non-binding information** — explaining a fee, summarising a statement — is a reasonable fit, with RAG grounding against our own documents, mandatory citations, and a verification step checking the cited source actually supports the claim. **Anything advisory or binding** — "should I take this product", eligibility, anything a customer could act on financially — goes through a human, or doesn't ship. And the numbers must come from the system of record via a tool call, never from the model's own generation, because a hallucinated balance is unacceptable at any error rate.

Then the controls a regulator will ask about: **every interaction logged with the prompt, retrieved context, model version and output**, because reproducing a decision is a requirement; a golden eval set with a CI regression gate so a prompt change can't silently degrade quality; PII handling into the provider, which is a data-residency and contractual question before it's a technical one; and **explainability** — if this ever informs a decision affecting a customer, "the model said so" is not a defensible answer under SR 11-7-style model risk management.

**Why it lands.** Hallucination as structural, tiering by consequence, tool-calls for facts, and the regulatory control set — which is what separates a fintech answer from a generic one.
**✗ Weak answer.** "Fine-tune it on our data so it doesn't hallucinate" — fine-tuning shapes behaviour, it doesn't add reliable facts.
**↳ Follow-ups.** How do you evaluate it before launch? What's logged, and for how long?

---

### Q2 · Prompt vs RAG vs fine-tune *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"The model doesn't know our internal products. A vendor is quoting us for fine-tuning. Good idea?"*

**Answer.** Probably not, because it's the wrong tool for the stated problem. **Fine-tuning shapes behaviour — format, tone, a narrow task — it does not reliably add facts**, and treating it as a knowledge store is the classic expensive mistake. It also means retraining every time a product changes, the knowledge is frozen at training time, there are no citations, and you can't tell whether an answer came from your data or the base model. For "the model doesn't know our products," **RAG is the answer**: the knowledge stays in a retrievable store, updates instantly, and every answer can cite its source.

The decision rule I'd give: **prompt** for behaviour and format; **RAG** for current, private, citable facts; **fine-tune** for a consistent skill or to run a narrow task on a cheaper model; **distillation** for cost at similar quality. Most "we need fine-tuning" requests are RAG or even a better prompt.

If we *did* fine-tune later — say the model keeps getting our output format wrong despite good prompting — I'd use **LoRA/QLoRA** rather than full fine-tuning: a fraction of a percent of the parameters, cheap, swappable per tenant, and far less catastrophic forgetting. And I'd want a golden eval set first regardless, because without it there's no way to know whether the spend improved anything.

**Why it lands.** Rejects the premise with the specific reason, gives the four-way decision rule, and names LoRA plus eval-set-first as conditions.
**✗ Weak answer.** "Yes, fine-tuning makes it domain-specific."
**↳ Follow-ups.** What would make you fine-tune? How do you evaluate RAG retrieval separately from generation?

---

### Quick-fire (30 seconds each)

- **"How would you build a RAG system for internal documents?"** → Ingest and chunk on document structure rather than fixed size, embed, and index — but retrieval is hybrid: dense plus BM25, fused, then a cross-encoder reranker, because embeddings alone fail on identifiers, names and negation. Generation is grounded — answer only from context, cite chunk ids, say "I don't know." Then the part that decides success: a golden set of query-to-relevant-document pairs, so I can measure retrieval precision and recall separately from answer quality. Most RAG failures are retrieval failures, and without that split you can't tell.
- **"How do you stop prompt injection?"** → You don't stop it, you contain it — there's no reliable filter, so it's defence in depth. Treat everything retrieved or user-supplied as untrusted data, never instructions; keep the instruction and data channels separate; and most importantly give the model least privilege on tools, because it can't misuse a capability it doesn't have. Irreversible actions get human approval. The case people miss is indirect injection — instructions embedded in a document the model retrieves — which makes retrieved content a trust boundary.
- **"What's the risk with autonomous agents?"** → Compounding failure. The loop is structurally a saga — multi-step, side-effecting, non-transactional — and at 95% per-step reliability ten steps is about 60% end-to-end. So I'd bound it: max steps, max spend, max wall-clock, checkpointed state, idempotent tool calls and compensating actions. And I'd calibrate human-in-the-loop by reversibility: read-only is autonomous, reversible writes are autonomous with an audit trail, and anything irreversible or money-moving takes approval.

---

**Go deeper:** `44-AI-Systems/01`–`12` · **Related:** [[16-Distributed-Systems]], [[34-CQRS-EventSourcing-Saga-Outbox]], [[28-Security]], [[27-Observability]]
