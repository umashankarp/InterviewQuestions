# Engineering Leadership (Staff+ / Principal / Architect) — Cram Sheet

> Tier 2 · Source: `51-Engineering-Leadership/` (5 modules, 5,776 lines) · Read: 12 min
> This is the sheet that decides your **level**, not whether you pass.

---

## 1. Influence Without Authority

- **Authority-based models fail mechanically at this level:** a Principal has no reporting line to the teams whose behaviour must change, and a decision imposed without buy-in is reversed as soon as attention moves. **Influence is the only mechanism that persists.**
- **Written artifacts are the primary leverage mechanism.** A document scales to people you never meet, across time zones and after you leave; a meeting does not. The Staff+ deliverables are: the design doc, the ADR, the technical strategy, the incident review, the RFC.
- **Disagree and commit — the precise discipline:** argue hard *before* the decision, with evidence; once decided, **commit visibly and completely**, including to people who weren't in the room. Undermining a decision you lost, or re-litigating it quietly, destroys the credibility you need for the next one. The other half: **record the disagreement** (in the ADR) so that if the predicted failure occurs, re-opening is cheap and blameless.
- **Translating technical debt into a business narrative:** never "the code is messy." Say **"this costs us X engineer-weeks per quarter and adds Y days to every release; a Z-week investment removes it, and here is the evidence."** Debt is a cost, not an aesthetic complaint.
- **The credibility ledger** — influence is a balance that you spend and replenish. Being right in public, delivering what you promised, and helping others succeed deposit; being wrong loudly, over-promising, or being unhelpful withdraw. You cannot spend what you have not deposited.
- **Recognisable failure modes:** the architect who only says no · the Staff engineer who is just a very senior IC on one team · the person who wins arguments and loses allies · the strategy nobody read.

---

## 2. Staff+ Archetypes (know which one you are)

| Archetype | Works on | Day looks like |
|---|---|---|
| **Tech Lead** | one team's execution | closest to a manager without the reports |
| **Architect** | one critical domain, deeply, across teams | design review, constraints, golden paths |
| **Solver** | the hardest problem of the moment, wherever it is | parachutes in, deep, then leaves |
| **Right Hand** | org-level leverage alongside a senior leader | scope follows the leader's priorities |

- The distinction is **operational, not taxonomic** — it tells you what your week should look like and what "done" means.
- **Scope and depth trade against each other.** Broad scope with shallow depth is an ineffective architect; narrow scope with great depth is a Senior engineer. Level comes from **holding both at a deliberately chosen ratio.**
- **Problem selection is the dominant term in the impact equation.** A brilliant solution to a problem that didn't matter scores nothing. Choosing what to work on *is* the Staff+ skill.
- **Glue work** (unblocking, aligning, documenting, mentoring, running the migration nobody owns) is genuinely high value **and a career trap** — it is often invisible in promotion packets. **Hold both truths:** do it, and make it legible by attaching it to a named outcome with a measured result.
- **Technical strategy is the durable deliverable** — a written document that outlives you and lets others make decisions consistently without asking.
- **Sponsorship ≠ mentorship.** Mentorship is advice; **sponsorship is spending your own credibility to put someone in a room or on a project.** Only sponsorship changes careers.

---

## 3. Principal Engineering

- **The mechanism changes:** Staff influences through projects and people; **Principal influences through systems — the decision system, the golden path, the standard, the review forum.** You stop making the decisions and start designing how decisions get made.
- **Design the decision system:** who has decision rights on what, what requires review, what is a two-way door that should never reach a committee. **Speed of good decisions is the output metric.**
- **Build vs buy at organisational scale** — the honest framework:
  - Is it **core differentiation**? Build. Is it undifferentiated heavy lifting? Buy.
  - Count the **total cost of building**: not the first version, but maintenance, on-call, security patching, and feature parity over 5 years.
  - Count the **real cost of buying**: licence, integration, lock-in, the exit cost, and the feature you will never get.
  - **Saying "buy" when your engineers want to build is a Principal-level act.**
- **Owning aggregate risk** — nobody else has the view across systems to say "these five independently-acceptable risks compose into an unacceptable one." That composition is the Principal's job.
- **Working with executives:** lead with the decision and the business impact, then the reasoning; give **options with trade-offs and a recommendation**, not an open question; quantify in money and time; never present unresolved engineering debate upward.

---

## 4. Architecture as a Role

- **The architect's product is constraints — and constraints have a cost function.** Every constraint you impose taxes every team, forever. You must be able to state what a constraint costs and why it is worth it. An architect who cannot is just issuing preferences.
- **Facilitator, not adjudicator.** The goal is that the teams reach a good decision and own it, not that you make the call and they comply. Comply-only decisions are reversed the moment you look away.
- **"Make the right thing the default" is the only mechanism that survives.** A golden path — templates, scaffolding, libraries, CI defaults — that is genuinely the easiest route beats any standard enforced by review. **Adoption is the metric, not compliance.**
- **Architecture is a claim requiring continuous verification** — "our services are loosely coupled" is a hypothesis until a fitness function proves it weekly.
- **Stakeholder translation, both directions:** engineering constraints → business consequences, *and* business goals → technical constraints. Doing only the first is the common failure.
- **Why enterprise architecture functions fail, specifically:** they become detached from delivery — producing diagrams and standards without shipping anything, with no feedback loop, so their models diverge from reality and teams route around them. **The fix is to stay in the code and own delivery for something real.**

---

## 5. Behavioural answers — the STAR+ structure

For every story: **Situation · Task · Action · Result — plus *Reflection*** (what you'd do differently). The reflection is what separates Staff from Senior.

**Have these six ready, with numbers:**
1. **A technical decision you got wrong** — and how you found out, and what you changed. (Never "I can't think of one.")
2. **Influencing without authority** — a change you drove across teams you didn't own.
3. **Disagree and commit** — where you lost and then committed visibly.
4. **A production incident you led** — detection, decision-making under uncertainty, the systemic fix, not just the patch.
5. **Saying no / buy-don't-build** — where you stopped work or bought instead of building.
6. **Growing someone** — ideally sponsorship, not just mentorship, with the outcome.

**Quantify everything:** "reduced p99 from 1.2s to 180ms" · "cut AWS spend 34% (£40k/mo)" · "took deploys from fortnightly to 12/day" · "removed 8 engineer-weeks/quarter of toil."

---

## Top traps

1. Describing Staff+ work as "writing more code."
2. No example of being wrong.
3. Technical debt framed aesthetically, not as a cost.
4. Winning the argument and losing the room.
5. Presenting an open engineering debate to an executive.
6. Constraints imposed with no stated cost.
7. Standards enforced by review instead of made the default.
8. Mentorship described as if it were sponsorship.
9. Glue work done but never made legible.
10. Never having recommended "buy" or "don't build it."

---

## Interview Q&A — Lead / Principal

**Structure every story as STAR+R: Situation · Task · Action · Result · *Reflection*.** The reflection is what separates Staff from Senior. **Quantify the Result every time** — a story without a number reads as a story.

### Q1 · A technical decision you got wrong *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"Tell me about a significant technical decision you got wrong."*

**Answer shape.** Pick something genuinely consequential — a data model, a framework commitment, a build-vs-buy — not "I once picked the wrong library." Structure: **what I decided and why it was reasonable with the information I had** (this matters; a decision that was obviously stupid at the time says something worse about you) → **the signal that showed it was wrong, and how long that took** → **what it cost**, in engineer-weeks or money → **what I changed**.

The part that scores is the reflection, and it should be about the **detection gap, not the decision**: "the more interesting question is why it took us four months to notice. We had no metric that would have shown it earlier. So beyond fixing the decision I added [the specific signal], and I now ask 'what would tell us this was wrong, and how fast?' before any decision of that size." That converts one mistake into a durable change in how you work, which is the actual answer to the question.

**Why it lands.** Owns it without self-flagellation, quantifies, and reflects on detection rather than on the decision itself.
**✗ Weak answer.** "I can't think of one" (disqualifying), a trivial example, or blaming circumstances.
**↳ Follow-ups.** How would you catch it faster now? Did you tell anyone at the time?

---

### Q2 · Influencing without authority *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"Tell me about a time you drove a change across teams you didn't own."*

**Answer shape.** The mechanism matters more than the outcome. What works: **writing and evidence, not seniority.** A document scales to people you'll never meet and outlives you; a meeting doesn't. Bring a measured cost, a prototype or an incident rather than a preference — "this pattern caused three of our last five Sev-2s, here's the data" beats "I think we should standardise."

Then the sequencing that actually works: find the team already feeling the pain and make them the proof point; let them advocate rather than you; make the new way **the easiest path** (a template, a library, a CI default) rather than a standard people must remember. And name the resistance honestly — usually a team with a legitimate competing priority, not opposition — so you're solving for their roadmap, not overcoming them.

Close with the credibility framing: influence is a ledger. Being right in public, delivering what you promised and helping other people succeed are deposits; you can't spend what you haven't banked.

**Why it lands.** Names the mechanism (written leverage, evidence), the adoption tactic (make it the default), and treats resistance as competing priorities rather than obstruction.
**✗ Weak answer.** "I escalated to their manager" or "I convinced them in a meeting."
**↳ Follow-ups.** What did you do about the team that still refused? How did you know it stuck?

---

### Q3 · Disagree and commit *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"Tell me about a time you disagreed with a decision and lost."*

**Answer shape.** Show both halves, because most candidates only show the first. **Before the decision:** argued hard, with evidence, in the right forum, and made sure the risk was understood by the person who owned the call — not just voiced, but genuinely understood. **After:** committed visibly and completely, including to people who weren't in the room, and did not re-litigate it in side conversations. Undermining a decision you lost destroys the credibility you need for the next one, and everyone can tell.

The sophisticated addition: **record the disagreement in the ADR** — what was decided, what I argued, what I predicted would happen. That isn't score-keeping; it's what makes re-opening cheap and blameless if the predicted failure occurs. Without the record, revisiting it later feels like an accusation; with it, it's just the trigger firing as documented.

If the story ends with you being right, be careful with the tone — "and I was right" is a worse answer than "the trigger fired about a year later, we revisited it with the ADR as the starting point, and it was a two-week conversation instead of a fight."

**Why it lands.** Both halves, the ADR as a blameless re-opening mechanism, and graceful handling of being vindicated.
**✗ Weak answer.** "I went along with it" (no disagreement) or "I was right and they should have listened."
**↳ Follow-ups.** What if you thought the decision was genuinely unsafe rather than just suboptimal?

---

### Q4 · Technical debt as a business case *(Principal)* ⭐⭐⭐⭐⭐
**Asked as:** *"How do you get the business to fund a refactor?"*

**Answer.** By never calling it a refactor. "The code is messy" is an aesthetic complaint and will lose to every feature, correctly. I'd translate it into the currency the decision is actually made in: **"this costs us roughly X engineer-weeks per quarter and adds Y days to every release, and here's the evidence — these five incidents, this change-failure rate, this lead time. A Z-week investment removes it, so it pays back in N months."**

Then make it concrete and bounded: not "rewrite the payments module," but a specific outcome with a measurable result and a defined end. Open-ended remediation never gets funded twice. And where possible, **attach it to work that's already funded** — the cheapest debt paydown is the kind that happens on the way to a feature the business already wants.

The honest part: some debt shouldn't be paid. If a component is being decommissioned in a year, living with it is correct, and being willing to say that is what makes people believe you the rest of the time. I'd also track debt as a visible liability with an owner, because debt that lives only in engineers' heads is always deprioritised.

**Why it lands.** Converts to cost and evidence, bounds the ask, attaches to funded work, and concedes that some debt is correctly left alone.
**✗ Weak answer.** "We need a tech-debt sprint" or arguing on code quality.
**↳ Follow-ups.** What if they still say no? How do you measure the X?

---

### Q5 · A production incident you led *(Lead)* ⭐⭐⭐⭐⭐
**Asked as:** *"Walk me through a serious incident you were responsible for."*

**Answer shape.** They're assessing decision-making under uncertainty, not your debugging. Cover: **detection** — did a customer tell us, or did we know first? (Be honest; "a customer told us" is a legitimate finding about the monitoring.) **Triage** — how you scoped impact and who you pulled in. **The decision under uncertainty** — the moment you had incomplete information and had to choose, e.g. "we could restart and clear it, but that would destroy the evidence we needed to scope which customers were affected, so we captured state first and accepted three more minutes of impact." That trade is the interesting part.

Then **communication** — updates on a fixed cadence, including when there was nothing new, because silence generates escalation. **Resolution**, then the **systemic fix** rather than the patch: "the immediate fix was X, but the real finding was that this class of bug could reach production at all, so we added Y to the build."

Reflection: what had **no detector**, and what you added.

**Why it lands.** Detection honesty, an explicit trade-off under uncertainty, comms discipline, and systemic over symptomatic.
**✗ Weak answer.** A heroic debugging narrative with no communication, no blast-radius scoping and no systemic follow-up.
**↳ Follow-ups.** What did the postmortem action items look like, and did they get done?

---

### Q6 · Saying no *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"Tell me about a time you pushed back on a request from the business."*

**Answer shape.** The best version isn't a refusal — it's a **re-scope**. Structure: what was asked, why it was reasonable from their side (always establish this; a Principal who thinks the business is stupid is a liability), the specific consequence that made it unworkable, and the **alternative you offered**. "No" alone is an obstacle; "not that, but here's what gets you 80% of the outcome by the date you need" is leadership.

Good examples: a deadline that could only be met by skipping the security review on a payments path; a feature that would have required storing card data and pulling us into PCI scope; a "quick" integration that would have made an unowned third-party service a hard dependency of checkout.

The reflection: name what it cost you — the relationship strain, the escalation — and how you repaired it. And if you were overruled and proceeded anyway, say so, say how you mitigated, and what happened. That's more credible than a story where you always win.

**Why it lands.** Re-scope over refusal, establishes the requester's legitimacy, and admits the cost including being overruled.
**✗ Weak answer.** A story where engineering is right and the business is foolish.
**↳ Follow-ups.** What if they'd overruled you? Did the relationship recover?

---

### Q7 · Growing someone *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"How have you developed engineers around you?"*

**Answer.** Distinguish the two things, because the distinction is the answer. **Mentorship is advice** — cheap, useful, and it doesn't change anyone's trajectory on its own. **Sponsorship is spending your own credibility** to put someone in a room, on a project, or in front of a decision-maker they wouldn't otherwise reach. Only sponsorship changes careers, and it costs you something — which is why far fewer people do it.

Give a concrete example with an outcome: identified someone ready for more scope, gave them the design for a system I'd have done myself, stayed available but didn't take it back when it wobbled — that last part is the hard bit — and advocated for them in the promotion round with specific evidence I'd deliberately created opportunities for them to generate.

Then scale: at Principal, the leverage isn't one person, it's the **system** — design review as a teaching forum rather than a gate, writing the documents that let people make decisions without asking, and creating the conditions where other people's good ideas get adopted. If everything good still routes through me, I've built a bottleneck, not a team.

**Why it lands.** The sponsorship/mentorship distinction, "didn't take it back", and the shift from individual to systemic leverage.
**✗ Weak answer.** "I do code reviews and pair with juniors."
**↳ Follow-ups.** Tell me about someone you couldn't help. How do you sponsor someone you don't manage?

---

### Q8 · Your first 90 days *(Principal)* ⭐⭐⭐⭐
**Asked as:** *"You join as Principal. What do you do in the first 90 days?"*

**Answer.** Listen first and resist the urge to prove value by proposing an architecture in week two — the fastest way to burn credibility is to redesign something before understanding why it's like that. **First 30 days:** meet every team, read the incident history (the most honest document in any organisation), read the code, and understand where the money comes from and what the regulatory constraints are. Write down what I think is wrong without acting on it, because I'll be wrong about a third of it.

**Days 30–60:** pick **one** thing that is real, painful, visible and finishable, and deliver it. Not a strategy document — something that makes people's week better, so the first thing I'm known for is delivery rather than opinions. That's the credibility deposit everything later draws on.

**Days 60–90:** now the leverage work — where are decisions made badly or slowly, what's the golden path, what has no owner, where's the aggregate risk nobody can see across systems. Then write the technical strategy, with the teams rather than at them, because something I hand down gets complied with and something we build together gets used.

**Why it lands.** Listening before acting, an early deliverable as a credibility deposit, and moving to systemic leverage in the right order.
**✗ Weak answer.** "Assess the architecture and present a modernisation roadmap."
**↳ Follow-ups.** What if you find something genuinely on fire in week one?

---

### Quick-fire (30 seconds each)

- **"What's the difference between Senior, Staff and Principal?"** → Scope of the problem and the mechanism of influence. Senior owns delivery of well-defined work on a team. Staff picks the problem — selection is most of the impact — and influences through projects, written strategy and people beyond their team. Principal influences through *systems*: the decision rights, the golden path, the standard, the review forum. At that point you're designing how decisions get made rather than making them, and you own the aggregate risk nobody else can see across systems.
- **"How do you influence teams you don't control?"** → Writing, evidence and credibility. A document scales to people I'll never meet and outlives me; a meeting doesn't. I bring evidence rather than preference — a measured cost, a prototype, an incident. And I treat credibility as a ledger: being right in public and delivering what I promised is what lets me spend it later. When I lose the argument I commit visibly, and record the disagreement in the ADR so re-opening it later is cheap and blameless rather than an I-told-you-so.
- **"Tell me about a decision you got wrong."** → *(Have a real one.)* Structure: what I decided and why it was reasonable with what I knew → the signal that showed it was wrong and how long that took → what it cost → what I changed, including the *detection* gap, not just the decision. The reflection matters more than the mistake: the interesting question is why it took three months to notice, and what monitoring or review step I added so the next wrong decision surfaces in days.

---

**Go deeper:** `51-Engineering-Leadership/01`–`05` · **Related:** [[30-Architecture-Patterns]], [[14-System-Design-Core]], [[17-Microservices]]
