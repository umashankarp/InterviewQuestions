# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this directory is

`Architect-Role-Cheat-Sheet/` is a self-contained set of 19 interview-prep documents for a
**Solution / Technical / Enterprise Architect** role, calibrated to hiring panels at investment
banks, payments companies, and capital-markets firms. Each file is one topic, written as a fixed
number of answered Q&A. There is no code, no build, and no test suite — the Markdown *is* the
deliverable.

## Relationship to the parent repo — read this first

This folder sits inside the larger `E:\Interview Questions` study program, which is governed by
`../CLAUDE.md` (a ~190-module program with an elaborate §1–§17 module template, a four-step System
Design standard, an interaction-mode system, and an authoritative Progress Log in
`00-Roadmap/README.md`).

**Those rules do not apply to files in this folder.** Specifically:

- This folder is **not** tracked in `00-Roadmap/README.md`'s Progress Log. Do not add Progress Log
  entries, module numbers, or `✅ **Module N**` lines for work done here.
- It does **not** use the parent's module template (A6) or System Design spine (A7). It has its own
  much simpler format (below).
- It **does** share the parent's calibration in spirit: elite fintech panel bar, 14+ years'
  experience assumed, answers that go mechanism → trade-offs → "what I'd actually do in production."

When `../CLAUDE.md` and this file disagree about how to write something *in this folder*, this file wins.

## Numbering and cross-references

Within this folder a bare number refers to the file with that leading number — **not** to a
parent-repo module:

- Prose cross-refs read `Module 4 Q15`, `Module 12 Q8`, or `(Microservices **04**, Security **15–17**)`
  and point at `04-Microservices.md`, `12-Architecture-Patterns.md`, etc. *in this folder*.
- File-to-file links are relative: `[05 — Distributed Systems](./05-Distributed-Systems.md)`.
- Individual questions are `## QN.` headings.

Topic map (leading number = the cross-reference key):

| Files | Group |
|---|---|
| 01–03 | Language / runtime — ASP.NET Core architecture, C#/.NET internals, async & performance |
| 04–08 | Distributed & messaging — microservices, distributed systems, design patterns, EDA, Kafka |
| 09–11 | Infra & performance — AWS, Kubernetes, performance engineering |
| 12–14 | Architecture patterns — layered/Clean/Hexagonal, event sourcing, CQRS+Saga+Outbox+Idempotency |
| 15–17 | Security — identity/OAuth/OWASP web, API security, database/data security |
| 18–19 | System design; AI / RAG |

## House style (consistent across all 19 files — match it exactly when editing)

1. **H1:** `# N. Topic — X Questions (Answered)`. `X` must equal the number of `## QN.` headings in
   the file. Update it whenever you add or remove a question.
2. **Intro blockquote**, one of the two established forms:
   - Files 01–03: `> Role lens: **Solution / Technical Architect**. …`
   - Files 04–19: `> **Method:** …` — names the **primary sources** whose definitions are quoted
     *verbatim* (Microsoft Learn, Azure Architecture Center, AWS docs / Well-Architected /
     Prescriptive Guidance, Apache Kafka docs, Kubernetes docs, IETF RFCs, OWASP, NIST, GoF,
     Anthropic Claude docs). Some files add a short `**Interview note:**` line.
3. **Each answer:** open with the definition/mechanism — quoted from the named official source
   where one exists, with the source named inline — then a comparison table or ASCII/code snippet,
   then an "architect's framing" / "the thing candidates get wrong" aside, then the production
   trade-off. `**Short answer:**` leads and `| … | … |` trade-off tables are the norm; prose,
   tables and fenced code sit directly under the `## QN.` heading (deeper sub-headings are rare).
4. **`## References`** at the end: a Markdown table (`| Topic | Source |`, sometimes `| … | URL |`)
   of official-documentation links. Anything quoted in the body gets a row here.
5. **Footer nav** (final line): `**Previous:** [NN — Title](./NN-...md) | **Next:** [NN — Title](./NN-...md)`.
   `01` carries **Next** only; `19` carries **Previous** only. Repair the chain if you add or reorder files.

Domain flavour is fintech (payments, ledger, settlement, reconciliation, PCI DSS / SOX) woven in
where it fits, never forced onto a domain-agnostic topic. Tech baseline is .NET 8/9, C# 13+, and
current AWS / Kubernetes / Kafka.

## Working in this folder

- **No build / lint / test tooling.** Files currently use **LF** line endings — keep whatever
  ending is already in the file you edit; do not bulk-convert.
- Repo commit messages are terse (`new questions`, `few updates in ai`). Match that.
- Consistency checks (the closest thing to a test suite here) — run from this folder:

```bash
# H1 "X Questions" count vs actual number of "## QN." headings
for f in [0-9]*.md; do
  h1=$(head -1 "$f" | grep -oE '[0-9]+ Questions' | grep -oE '[0-9]+')
  q=$(grep -c '^## Q[0-9]' "$f")
  [ "$h1" = "$q" ] || echo "MISMATCH $f: H1=$h1 headings=$q"
done

# every file must have a References section and a footer nav line
grep -L '^## References' [0-9]*.md
grep -L '\*\*Previous:\*\*\|\*\*Next:\*\*' [0-9]*.md
```
