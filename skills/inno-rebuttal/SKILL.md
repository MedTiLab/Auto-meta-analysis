---
name: inno-rebuttal
description: Drafting and refining academic rebuttals for top-tier AI/CS conferences (NeurIPS, ICML, ICLR, CVPR, ECCV, AAAI, ARR, KDD, UAI, AISTATS, TMLR, etc.). Use this skill whenever the user needs to respond to reviewer comments, write a rebuttal, handle reviewer feedback, clarify technical misunderstandings, present additional experimental results, or deal with borderline accept/reject decisions. Also trigger when the user mentions keywords like "rebuttal", "reviewer", "review response", "author response", "camera-ready", "rebut", "AC", "area chair", "meta-review", or discusses conference review scores. Trigger for Chinese-language requests too, e.g. "写rebuttal", "回复审稿人", "审稿意见", "rebuttal怎么写", "reviewer说我的baseline不够".
allowed-tools: Read Write Edit Bash
license: MIT license
metadata:
    skill-author: K-Dense Inc.
---

# Academic Rebuttal Drafting and Refinement

## Overview

A rebuttal is a venue-constrained response workflow, not just a writing task. The goal is to clarify misunderstandings, resolve decision-relevant concerns, convert review analysis into an actionable task list, and produce the correct submission artifact for the target venue.

This skill supports multiple end states depending on what the user needs:

- review analysis only,
- analysis plus prioritized task list,
- task list plus paper edit plan,
- full venue-specific rebuttal draft,
- final pre-submission verification.

## Handling Inputs

Reviews arrive in many formats. Before starting analysis:

- **Pasted text**: Use directly. Ask the user to confirm whether the paste is complete.
- **PDF reviews**: Read the PDF and extract all review text, scores, and confidence levels.
- **Screenshots**: Read the image and transcribe all visible review content. Flag any truncated or unclear sections.
- **OpenReview / CMT links**: Ask the user to paste the review text, since external platform access is unreliable.
- **LaTeX source or paper PDF**: Read as needed to cross-reference claims reviewers question.

If reviews are incomplete (e.g., missing scores or confidence), ask the user before proceeding.

## Routing First

Before drafting anything, determine the venue and route the workflow using `references/venue_rule_matrix.md`.

Primary routing dimensions:

1. **Artifact structure**: one-page PDF rebuttal, per-review response, threaded discussion, rolling review / revision plan, or single-feedback response.
2. **Revision policy**: revised manuscript allowed during discussion, not allowed, or unclear (use conservative handling).
3. **Policy constraints**: anonymity, external links, new experiments, confidential AC channel, LLM disclosure requirements.

If the venue is unknown or only partially confirmed, state that explicitly and choose the most conservative workflow.

---

## Rebuttal Workflow

Run the workflow in stages. Do not force a user confirmation pause after every stage unless the user asked for a checkpoint or the next step is risky.

### Stage 1: Review Analysis, Classification, and Issue Board

Analyze all reviews to identify core themes, major technical "deal-breakers," and common questions.

**Key Actions:**

- **Extract a Score Matrix:** Create a table listing Reviewer ID, scores, confidence, and a short summary of each review's decision logic.
- **Classify Reviewer Stance:** Label each reviewer as Champion (score >= 7, positive language), Persuadable (score 4-6, mixed), or Entrenched (score <= 3, strong negative). This guides effort allocation — invest most in converting Persuadable reviewers while maintaining Champion support. See `references/writing_principles.md` for stance-based tone guidance.
- **Identify Decision-Critical Concerns:** Combine low scores, high confidence, repeated concerns across reviewers, and likely AC-facing issues.
- **Group Common Concerns:** Identify points raised by multiple reviewers (e.g., [R1, R3] both ask about Baseline X).
- **Categorize Issues:** Distinguish between soundness, novelty, significance, clarity, missing baselines, missing ablations, theory gaps, limitations, ethics, and minor edits.
- **Assign Severity:** Use the following classification for each concern:

| Severity | Definition |
|---|---|
| **Major-Blocking** | Can single-handedly cause rejection (methodology flaws, novelty challenges) |
| **Major-Addressable** | Significant but resolvable with evidence or targeted revision |
| **Minor** | Clarity, formatting, typos — low decision weight |
| **Misunderstanding** | Reviewer missed existing content in the paper |

- **Identify "The AC's Perspective":** What will an Area Chair see as the main reason to accept or reject?

**Output: Issue Board**

Build a structured Issue Board tracking every atomized concern. For single-reviewer or purely-minor scenarios, a simpler table suffices.

```
issue_id | reviewer | severity          | category   | strategy | status
R1-1     | R1       | Major-Blocking    | baselines  | (TBD)    | open
R1-2     | R1       | Minor             | clarity    | (TBD)    | open
R2-1     | R2       | Misunderstanding  | novelty    | (TBD)    | open
R2-2     | R2       | Major-Addressable | ablations  | (TBD)    | open
R3-1     | R3       | Major-Addressable | baselines  | (TBD)    | open  [shared with R1-1]
```

Update the `strategy` and `status` columns as you progress through subsequent stages. Before finalizing (Stage 5), every Major-Blocking and Major-Addressable issue must reach status=done.

See `references/issue_board_guide.md` for the full schema, a worked example, and cross-review consistency checking.

If the user requested only analysis, stop here. Otherwise continue to Stage 2.

### Stage 2: Strategy Selection

For each issue on the board, select one or more response strategies. The right strategy depends on whether the reviewer's point is factually correct and how much it affects the acceptance decision.

| Strategy | When to use | Example |
|---|---|---|
| **Accept and fix** | The reviewer is right, and the fix is feasible before deadline | Missing ablation that can be run quickly |
| **Clarify misunderstanding** | The paper already addresses this but the reviewer missed it | Reviewer says "no comparison to X" but Table 3 has it |
| **Partial agree and narrow claim** | The concern is valid but only for a subset of claims | "We agree this doesn't hold for non-stationary settings; we've narrowed Theorem 2 accordingly" |
| **Respectful disagreement** | The reviewer's technical position is demonstrably incorrect, and you have evidence | Reviewer claims method can't handle Y, but Appendix B shows results on Y |
| **Out of scope** | The request is legitimate but fundamentally beyond the paper's contribution | "Adding a full theoretical analysis of convergence is important future work; we've added this to our limitations" |
| **Escalate to AC** | Reviewer conduct or factual errors best addressed privately (only if venue supports confidential AC notes) | Reviewer appears to have conflicts or misattributes prior work |

**Strategy Combinations**

Real concerns often need compound strategies. Common combos:

- **Clarify + Accept partial**: "We already address X in Section 3.2, but we agree the presentation was unclear. We have rewritten the paragraph and added a clarifying figure."
- **Accept + New evidence**: "We agree this baseline was missing. We have now run the comparison — results in the table below show our method outperforms by 2.1%."
- **Partial agree + Scope narrow**: "We agree the claim is too broad for the non-stationary case. We have narrowed Theorem 2 to the stationary setting and added this as a limitation."

See `references/response_strategies.md` for detailed templates, full worked examples, and tone before/after comparisons.

**Key Principles:**
- **Be Direct:** Answer the core question in the first sentence.
- **Evidence Over Promises:** Prefer actual evidence. If evidence is missing, convert that gap into a concrete task rather than hand-waving.
- **Professional Tone:** Avoid defensive phrasing.
- **Venue Awareness:** Do not suggest new experiments, new figures, revised PDFs, or external links unless the venue rules support them.

**Output:** Update the Issue Board with the chosen strategy for each issue.

### Stage 3: Task List Synthesis

Convert the strategy map into an actionable task list.

Typical task types:

- rerun or add an experiment
- collect a missing baseline number
- extract evidence already present in the paper
- rewrite an unclear claim
- soften an overclaim
- add a limitation
- prepare a confidential AC note
- compress a draft to fit venue limits

For each task, record: owner if known, required input, expected output, whether it must happen before drafting, whether it changes the manuscript, the rebuttal only, or both.

If the user asked for planning plus execution, carry out the feasible tasks before drafting.

### Stage 4: Draft the Correct Artifact

Compose the full rebuttal, respecting conference-specific formats. Select the output structure from the venue router in `references/venue_rule_matrix.md`:

- **One-page PDF rebuttal** (CVPR, ICCV, ECCV): short summary, merged high-impact concerns, only the most decision-relevant reviewer-specific points.
- **Per-review response** (ICML, KDD): one response block per review, direct answer first, then evidence.
- **Threaded discussion** (ICLR, NeurIPS, UAI, AISTATS): concise opening, reply to concrete questions, keep follow-ups easy.
- **Rolling review** (ARR, TMLR): response now plus revision plan for the next manuscript version.
- **Single-feedback** (AAAI, The Web Conference): prioritize issues most likely to affect committee discussion.

**Character Budget** (for venues with explicit limits)

When the venue imposes a character or word limit, allocate the budget before writing:

| Section | Budget share | Purpose |
|---|---|---|
| Opener / global summary | 10-15% | Thank reviewers, preview top resolutions |
| Per-reviewer responses | 75-80% | Core content, allocated proportionally to issue severity |
| Closing / summary of changes | 5-10% | Acceptance case, remaining items |

For example, with ICML's 5000-character limit: ~600 chars opener, ~4000 chars per-reviewer, ~400 chars closing. Verify the final count with `scripts/count_limits.sh`.

When the venue has no explicit limit, skip budgeting.

**Dual Output**

Produce two versions of every rebuttal:

1. **Paste-ready version**: Plain text (or minimal markdown) that fits directly into the venue's submission form (OpenReview, CMT, EasyChair). Stripped of formatting the platform does not support. Verified against character limits with `scripts/count_limits.sh`.
2. **Extended version**: Full markdown with complete evidence tables, internal cross-references, and author notes marked with `[INTERNAL]`. This is the team's working copy for review before submission.

Generate the extended version first, then strip it down for the paste-ready copy.

**Formatting:**
- Use [R1], [R2], etc., for reviewer IDs.
- Use bolding or headers for key themes (e.g., **Novelty:**, **Baselines:**).
- Use "Q/A" format only when it fits the venue and saves space.
- Keep responses self-contained: include the key clarification or result in the response itself.

**Example of a good response to a reviewer concern:**

> **[R2] Missing comparison to MethodX**
>
> We appreciate this suggestion. We have added a comparison to MethodX on all three benchmarks. As shown below, our method outperforms MethodX by 2.3% on CIFAR-100 and 1.8% on ImageNet-1K, while being 1.5x faster at inference:
>
> | Method | CIFAR-100 | ImageNet-1K | Inference (ms) |
> |---|---|---|---|
> | MethodX | 82.1 | 79.4 | 12.3 |
> | Ours | 84.4 | 81.2 | 8.1 |
>
> We have updated Table 2 in the revised manuscript.

**Example of a bad response (avoid this):**

> ~~We believe the reviewer failed to notice that our method is clearly superior. We will add the comparison in the camera-ready.~~

The bad version is defensive ("failed to notice"), provides no evidence, and makes an empty promise.

### Stage 5: Refinement, Safety Gates, and Constraint Management

Before polishing the draft, run three mandatory safety gates. If any gate fails, fix the issue before proceeding.

**Safety Gate 1 — Provenance Gate**

Every factual claim in the rebuttal (numbers, experimental results, section references) must trace to a verifiable source: the manuscript, experimental logs, or an explicitly labeled planned change. If a claim has no source, either ground it or remove it. The rebuttal must never invent experiments, data, citations, or reviewer positions.

**Safety Gate 2 — Commitment Gate**

Every promise in the rebuttal ("we have updated Table 2", "we added an ablation") must be verified. If the rebuttal says "we have updated Table 2," confirm that Table 2 was actually updated. If the venue does not allow manuscript revision during discussion, reframe promises as planned changes for the camera-ready version and label them clearly.

**Safety Gate 3 — Coverage Gate**

Cross-check the Issue Board: every issue with severity Major-Blocking or Major-Addressable must have status=done. No major concern may be left unaddressed. Minor issues should be at least acknowledged ("We thank the reviewer and have corrected the typos throughout").

**Polish Checklist:**
- **Length Verification:** Use `scripts/count_limits.sh <file> [--chars|--words]` to verify length limits empirically. Do not rely solely on estimation.
- **Clarity:** Is the most important information (new results) easy to find?
- **Anonymity:** No names, institution links, or non-anonymized URLs.
- **Tone Check:** Professional even when responding to harsh reviews?
- **Response Accuracy:** Does the response actually answer the reviewer's *specific* concern?
- **Policy Check:** Confirm the draft does not violate venue rules on links, revised manuscripts, new experiments, or disclosure. See `references/platforms_and_policies.md`.
- **Evidence Check:** Every concrete claim is supported by the manuscript, real results, or an explicitly labeled planned change.
- **Cross-Review Consistency:** No contradictory answers to different reviewers. Use the Issue Board to verify shared concerns received consistent treatment.

### Stage 6: Follow-Up Rounds

This stage applies to venues with multi-round discussion: ICLR, NeurIPS, UAI, AISTATS, ICML 2026 (3 rounds), ARR, TMLR. Consult `references/venue_rule_matrix.md` to confirm whether the venue supports follow-up.

When new reviewer comments arrive after the initial response:

1. **Update the Issue Board**: Mark acknowledged issues as resolved. If a reviewer raises a new concern, add it with a new issue_id and route through Stage 2 strategy selection.
2. **Draft delta replies only**: Respond to new or unresolved points. Do not rewrite the full rebuttal.
3. **Back-reference prior answers**: If a reviewer repeats a concern already addressed, respond briefly: "As noted in our initial response, [one-sentence summary]. We are happy to clarify further if a specific aspect remains unclear."
4. **Escalate technically, not rhetorically**: If the reviewer pushes back, add evidence or concede narrowly. Do not increase argumentative intensity.
5. **Cap at 3 follow-up rounds**: If a disagreement persists after 3 rounds, summarize the positions cleanly and rely on the AC to adjudicate. Further argumentation is rarely productive.
6. **Rolling review pivot**: For ARR and TMLR, shift from rebuttal mode to revision-plan mode after round 1 — focus on what will change in the next manuscript version rather than defending the current one.

Re-run the three safety gates (provenance, commitment, coverage) for each follow-up response.

---

## Tone and Language Guidelines

Maintain a "Scientific Partnership" tone rather than an "Adversarial" one. See `references/writing_principles.md` for detailed stance-based tone guidance and `references/response_strategies.md` for before/after comparisons.

**Recommended Phrases:**
- "To clarify a potential misunderstanding, we actually..."
- "We agree that [X] is important, and we have now added results for [X] in Table 1."
- "As mentioned in Section 3.2 of the paper, we account for [Y] by..."
- "While [Method Z] is related, our approach differs in that..."

**Avoid:**
- "The reviewer failed to understand..."
- "The reviewer is wrong about..."
- "It is obvious that..."
- "We will definitely fix this in the camera-ready version" (without providing the fix/data now).

## Resources

Load references only as needed:

- For cross-venue writing guidance, reviewer stance classification, and tone calibration, see `references/writing_principles.md`.
- For venue-specific constraints and timelines, see `references/venue_rule_matrix.md`.
- For platform mechanics and policy constraints (OpenReview, LLM usage, anonymity, external links), see `references/platforms_and_policies.md`.
- For detailed strategy templates, combo examples, tone before/after comparisons, and successful case patterns, see `references/response_strategies.md`.
- For Issue Board schema, worked examples, and coverage verification, see `references/issue_board_guide.md`.

## Common Rebuttal Pitfalls

- **Being Defensive:** Arguing with the reviewer's opinion rather than addressing their technical concern.
- **Ignoring Reviewers:** Not responding to a low-confidence or short review (even a simple "Thank you" is better).
- **Wasting Space on Typos:** Spending 20% of the rebuttal on minor grammar fixes while ignoring a baseline request.
- **Over-Promising:** Saying "We will do X" without showing any preliminary proof that X is possible or already done.
- **Inconsistent Cross-Review Answers:** Telling R1 you've narrowed the claim while telling R3 the original claim still holds.
- **Fabrication:** Inventing experiments, numbers, or reviewer positions that do not exist. This is a hard disqualifier.

## Final Checklist

Before finalizing the rebuttal, verify:

- [ ] All major technical concerns have been addressed with evidence.
- [ ] Issue Board: all Major-Blocking and Major-Addressable items have status=done.
- [ ] Provenance gate passed: every factual claim has a verifiable source.
- [ ] Commitment gate passed: every promise verified or venue-appropriate.
- [ ] Coverage gate passed: no major concern left unaddressed.
- [ ] Tone is professional, polite, and non-defensive.
- [ ] "Response-First" structure is used for all key points.
- [ ] Reviewers are correctly cited (e.g., [R1], [R2]).
- [ ] Character/page limits are strictly followed (verified with `scripts/count_limits.sh`).
- [ ] Character budget allocation respected (for limited venues).
- [ ] New experimental results are summarized clearly.
- [ ] No anonymity violations.
- [ ] No unsupported claims about manuscript changes, experiments, or reviewer intent.
- [ ] The artifact type matches the venue's actual rebuttal mechanism.
- [ ] Cross-review consistency: no contradictory answers to different reviewers.
- [ ] Both paste-ready and extended versions produced.
- [ ] The Area Chair (AC) can easily understand the main "message" of the rebuttal.

## Design Influences

Several ideas in this skill were adapted from community rebuttal tools:

- Review classification, strategy templates, tone guidelines, and success case patterns: inspired by the **review-response** skill.
- Safety gates, issue board, character budgeting, follow-up rounds, and dual output: inspired by the **rebuttal** skill by wanshuiyin ([source](https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep)).
