# Rebuttal Writing Principles

Last updated: 2026-03-24

Use this file for cross-venue rebuttal guidance that does not depend on one conference's mechanics.

## Core goals

- Correct factual misunderstandings and remove ambiguity.
- Address the highest-impact reviewer concerns first.
- Make the response easy for reviewers and ACs to scan.
- Replace vague promises with evidence whenever possible.

## Stable writing principles

### 1. Start with a short global summary

Open with a compact summary that:

- thanks reviewers,
- restates the paper's main strengths or consensus positives,
- previews the top issues you are addressing.

This is especially useful when multiple reviewers raised overlapping concerns.

Sources:
- PLOS Computational Biology, "Ten simple rules for writing a response to reviewers": https://journals.plos.org/ploscompbiol/article?id=10.1371%2Fjournal.pcbi.1005730
- "How to write a convincing response to reviewers": https://pmc.ncbi.nlm.nih.gov/articles/PMC6269172/

### 2. Use point-by-point responses

For each concern:

- quote or paraphrase the concern clearly,
- answer it directly in the first sentence,
- provide evidence, clarification, or scope boundaries,
- say what changed in the manuscript if relevant.

This keeps the reply self-contained and reduces back-and-forth scanning.

Sources:
- PLOS Computational Biology: https://journals.plos.org/ploscompbiol/article?id=10.1371%2Fjournal.pcbi.1005730
- BMC article on replying to reviewers: https://pmc.ncbi.nlm.nih.gov/articles/PMC6347010/

### 3. Prefer evidence over promises

When a reviewer asks for clarification or validation:

- provide the actual result if available,
- otherwise explain what can and cannot be done before the deadline,
- if work is out of scope, state the limitation explicitly and place it in the paper's limitations or discussion.

Avoid relying on "we will add this later" unless the venue explicitly allows only lightweight rebuttal discussion and no paper revision.

Sources:
- PLOS Computational Biology: https://journals.plos.org/ploscompbiol/article?id=10.1371%2Fjournal.pcbi.1005730
- Springer author guide on reviewer responses: https://www.springer.com/gp/authors-editors/journal-author/revising-your-paper-and-responding-to-reviewer-comments/1422

### 4. Treat reviewer misunderstanding as a writing problem first

Do not write that the reviewer "failed to understand" the paper.
Instead:

- acknowledge the concern,
- explain the point neutrally,
- say that the paper text was strengthened if applicable.

This is a robust tone pattern across conference and journal settings.

Sources:
- "How to write a convincing response to reviewers": https://pmc.ncbi.nlm.nih.gov/articles/PMC6269172/
- Springer author guide: https://www.springer.com/gp/authors-editors/journal-author/revising-your-paper-and-responding-to-reviewer-comments/1422

### 5. Calibrate tone by reviewer stance

Not all reviewers need the same treatment. Classify each reviewer's stance early (during Stage 1) and adjust your communication accordingly.

**Champion (score >= 7, positive language):**
- Brief thanks for specific acknowledged strengths.
- Address any minor concerns promptly — you want this reviewer to stay enthusiastic.
- Reinforce their positive framing: "As R2 noted, our method's key advantage is [X]. We have further strengthened this with [Y]."
- A happy champion can advocate for your paper in the AC discussion.

**Persuadable (score 4-6, mixed language):**
- Primary conversion target. Invest the most effort here.
- Lead with evidence density — concrete numbers, tables, direct citations.
- Address their top concern with the strongest available evidence.
- Acknowledge valid points generously; this builds goodwill.

**Entrenched (score <= 3, strong negative language):**
- Do not over-invest in lengthy argumentation — it rarely changes an entrenched position.
- Answer factual errors clearly and concisely with evidence.
- Avoid matching aggressive tone. Stay maximally professional.
- Focus on making the AC's job easy: if the AC reads your response, they should see that the concern was addressed even if the reviewer remains unconvinced.

Design influences: the champion/persuadable/entrenched classification draws on CVPR rebuttal strategy patterns from the review-response skill and the reviewer_stance concept from the rebuttal skill by wanshuiyin.

### 6. Cover every major issue, but prioritize ruthlessly

Not all venues expect the same level of exhaustiveness:

- traditional journal response letters often expect near-complete point-by-point coverage,
- ICML-style rebuttal threads explicitly favor concise handling of key issues over exhaustive replies to every minor point,
- ARR and TMLR reward clear resolution of core concerns more than long argumentative exchanges.

This means the skill should separate:

- must-answer major concerns,
- overlapping concerns that can be merged,
- minor edits that can be acknowledged briefly.

Sources:
- ICML 2025 Reviewer Instructions: https://icml.cc/Conferences/2025/ReviewerInstructions
- ARR author guidance: https://aclrollingreview.org/authors
- TMLR reviewer guide: https://jmlr.org/tmlr/reviewer-guide.html

### 7. Merge repeated concerns across reviewers

If multiple reviewers raise the same issue:

- answer once in a global section if the venue format allows it,
- then point reviewer-specific replies to that answer.

This is one of the most reliable space-saving patterns for AI conference rebuttals.

Sources:
- PLOS Computational Biology: https://journals.plos.org/ploscompbiol/article?id=10.1371%2Fjournal.pcbi.1005730
- Common conference rebuttal practice derived from venue rules in `venue_rule_matrix.md`

### 8. Do not over-argue

Long adversarial exchanges are usually low leverage.

- ARR explicitly notes that lengthy back-and-forth is often not worth it.
- TMLR expects discussion, but still rewards technically productive exchanges over rhetorical combat.

When a reviewer remains unconvinced:

- summarize the clarification once,
- state the supporting evidence,
- mark unresolved scope limits cleanly.

Sources:
- ARR author guidance: https://aclrollingreview.org/authors
- TMLR reviewer guide: https://jmlr.org/tmlr/reviewer-guide.html

## Useful concern categories for parsing reviews

These categories map well to mainstream CS/AI review forms:

- novelty or originality
- technical soundness or quality
- clarity or presentation
- significance or impact
- missing baselines
- missing ablations
- theory or proof gaps
- limitations or assumptions
- ethical or policy concerns
- reproducibility or release concerns

OpenReview default forms and NeurIPS reviewer forms heavily overlap on these axes.

Sources:
- OpenReview default review form: https://docs.openreview.net/reference/default-forms/default-review-form
- NeurIPS 2025 Reviewer Guidelines: https://neurips.cc/Conferences/2025/ReviewerGuidelines

## Implications for the skill

The skill should support at least these stages:

1. Parse and atomize reviewer concerns.
2. Group repeated concerns across reviewers.
3. Classify each concern by type and response strategy.
4. Build a prioritized task list from the analysis.
5. Draft self-contained responses using venue-specific constraints.
6. Run tone, evidence, and policy checks before final submission.
