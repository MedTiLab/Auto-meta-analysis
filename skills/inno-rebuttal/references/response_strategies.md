# Response Strategies, Templates, and Cases

Last updated: 2026-03-24

Use this file when drafting rebuttal responses. It provides detailed templates for each strategy, combination patterns, tone before/after comparisons, and venue-family adjustments.

Design influences: templates and case patterns adapted from the review-response skill; venue-family adjustments combine review-response conference-specific strategies with this skill's venue routing.

## Strategy Templates

For each strategy, use the three-part pattern: **direct answer → evidence → implication**.

### Accept and Fix

**Opening pattern:** "We thank the reviewer for this valuable suggestion. We have [specific action]."

**Evidence pattern:** Show the concrete change — revised text, new table row, updated figure. Include the exact location (section, page, table number).

**Closing pattern:** "These changes are reflected in [location]."

**Example:**
> **[R1] Missing ablation study on attention heads**
>
> We thank the reviewer for this important suggestion. We have conducted ablation experiments varying the number of attention heads from 1 to 16. Results show that performance plateaus at 8 heads (Table 5, Appendix C). We have added this analysis to Section 4.3.

### Clarify Misunderstanding

**Opening pattern:** "We thank the reviewer for raising this point. We would like to respectfully clarify that [clarification]."

**Evidence pattern:** Cite exact location in the paper. Quote or paraphrase the relevant passage. If the writing was unclear, acknowledge it and describe the revision.

**Closing pattern:** "To make this more prominent, we have [improvement]."

**Example:**
> **[R2] No comparison with MethodX**
>
> We thank the reviewer for this comment. We would like to respectfully clarify that we did include a comparison with MethodX — results are in Table 2 (page 6, row 4) and discussed in Section 4.2 (lines 198-205). We acknowledge this was not sufficiently prominent. We have added a dedicated paragraph highlighting the comparison and included MethodX in Figure 3 for visual clarity.

### Partial Agree and Narrow Claim

**Opening pattern:** "We agree that [valid part of the concern]. We have [specific narrowing action]."

**Evidence pattern:** Show exactly what changed — quote the original claim and the revised claim side by side.

**Closing pattern:** "We have added this as a limitation in Section [X]."

**Example:**
> **[R3] Theorem 2 does not hold for non-stationary distributions**
>
> We agree that our original claim was too broad. Theorem 2 is correct under the stationarity assumption stated in Section 3.1, but the abstract overstated its generality. We have revised the abstract from "holds for all distributions" to "holds under stationarity (Assumption 1)" and added the non-stationary case as an explicit limitation in Section 5.2.

### Respectful Disagreement

**Opening pattern:** "We appreciate the reviewer's perspective. We respectfully note that [our position], supported by [evidence]."

**Evidence pattern:** Cite specific results, theorems, or external references. Never argue from authority alone — provide data.

**Closing pattern:** "We have added [clarification] to the manuscript to make this reasoning explicit."

**Example:**
> **[R1] The method cannot scale beyond 10K nodes**
>
> We appreciate the reviewer's concern about scalability. We respectfully note that Appendix B (Table 7) already reports results on graphs with up to 100K nodes, where our method maintains linear time complexity. The confusion may arise from the main text experiments, which use smaller graphs for fair comparison with baselines that cannot scale. We have added a cross-reference to the Appendix results in Section 4.1.

### Out of Scope

**Opening pattern:** "We appreciate this suggestion. While [topic] is valuable, it is beyond the scope of this work because [reason]."

**Evidence pattern:** Explain the boundary clearly and non-defensively. Acknowledge the importance of the suggestion.

**Closing pattern:** "We have added this as future work in Section [X]."

**Example:**
> **[R2] The paper should include a full convergence proof**
>
> We appreciate this suggestion. A formal convergence analysis would indeed strengthen the theoretical contribution. However, our primary contribution is the empirical framework, and a rigorous convergence proof would require substantially different mathematical machinery. We have added this as a clear future work item in Section 5.3 and cited [relevant theoretical work] as a starting point.

### Escalate to AC

Use only when the venue supports confidential AC notes. Keep factual and brief.

**Pattern:** "We wish to bring to the AC's attention that [factual observation]. We believe this may affect the fairness of the review."

---

## Strategy Combinations

### Combo 1: Clarify + Accept partial

> **[R1] The paper does not discuss related work Y**
>
> We thank the reviewer. We did discuss Y briefly in Section 2.1 (page 3), but we agree the coverage was insufficient. We have expanded the discussion to a full paragraph comparing our approach with Y's framework and highlighting the key differences (revised Section 2.1).

### Combo 2: Accept + New evidence

> **[R2] Missing comparison with recent baseline Z**
>
> We thank the reviewer for this excellent suggestion. We have added a full comparison with Z on all three datasets:
>
> | Method | CIFAR-100 | ImageNet | Speed (ms) |
> |---|---|---|---|
> | Z | 83.2 | 78.9 | 15.1 |
> | Ours | 85.5 | 80.7 | 9.4 |
>
> Our method outperforms Z by 2.3% on CIFAR-100 while being 1.6x faster. Results added to Table 3.

### Combo 3: Partial agree + Scope narrow + Future work

> **[R3] The claims about generalization are too strong given only vision experiments**
>
> We agree that our experiments focus on the vision domain and the generalization claim was overstated. We have revised the abstract and introduction to scope our claims to "vision tasks" rather than "general representation learning." We have also added experiments on two NLP benchmarks (Appendix D) as preliminary evidence that the approach transfers, and listed cross-domain evaluation as future work in Section 5.2.

### Combo 4: Defend + Additional evidence

> **[R1] Method Y would be more appropriate than your approach**
>
> We appreciate this suggestion. We chose our approach over Y because Y requires graph structure to remain fixed during training (see Y's paper, Section 5), whereas our setting involves dynamic graphs. To strengthen this point, we have added a head-to-head comparison: when applied to our dynamic-graph benchmarks, Y's performance drops by 12.3% compared to its static-graph results, while our method maintains consistent performance. This analysis is now in Section 4.4.

---

## Tone Before/After Comparisons

### 1. Responding to a factual error

**Bad:** "The reviewer failed to notice that we already included this experiment in Table 3."

**Good:** "We thank the reviewer for this comment. We would like to respectfully clarify that this experiment is included in Table 3 (page 7). To make it more visible, we have added a dedicated paragraph in Section 4.2."

*Why it matters:* "Failed to notice" sounds accusatory. Reframe the issue as a writing clarity problem, not a reading comprehension problem.

### 2. Responding to a request you cannot fulfill

**Bad:** "This is impossible. We don't have access to that dataset."

**Good:** "We appreciate this suggestion. While dataset X would be valuable, it requires institutional access we do not currently have. We have instead conducted experiments on dataset Y, which shares similar properties (scale, domain, label structure). Results in Appendix E."

*Why it matters:* Always offer an alternative when saying no.

### 3. Responding to a harsh novelty critique

**Bad:** "We strongly disagree. Our method is clearly novel and the reviewer does not understand our contribution."

**Good:** "We appreciate the reviewer's perspective on novelty. Our contribution lies specifically in [concrete technical difference]. Unlike prior work A which [limitation], our approach [specific advantage], as demonstrated in Table 4. We have added a clearer novelty statement to the introduction."

*Why it matters:* Claiming novelty without evidence is counterproductive. Show, don't tell.

### 4. Making a promise

**Bad:** "We will add more experiments in the camera-ready."

**Good:** "We have conducted the requested ablation study. Results show [finding] (Table 6). We have updated Section 4.3 accordingly."

*Why it matters:* Reviewers trust evidence, not promises. If you truly cannot complete the work, say: "Due to computational constraints during the rebuttal window, we provide preliminary results on [subset]. Full results will appear in the revision."

### 5. Acknowledging a weakness

**Bad:** "This is beyond the scope of our paper." (with no further explanation)

**Good:** "We agree this is a limitation of our current approach. Our method assumes [assumption], which does not hold in [scenario]. We have added this to the Limitations section (Section 5.2) and discuss potential solutions as future work."

*Why it matters:* Honest, specific limitations build credibility. Vague dismissals do the opposite.

---

## Venue-Family Strategy Adjustments

### One-shot PDF venues (CVPR, ICCV, ECCV)

- Merge shared concerns into global sections — space is extremely limited.
- Lead with the 2-3 most decision-critical issues.
- Prefer compact evidence (small tables, key numbers) over prose.
- Do not waste space on typo acknowledgments — a single sentence covers all.

### Threaded discussion venues (ICLR, NeurIPS, UAI, AISTATS)

- Can afford more incremental clarification across rounds.
- First response should be comprehensive; follow-ups can be focused.
- Maintain a running issue board to track resolution across rounds.

### Per-review response venues (ICML, KDD)

- Each response is self-contained — avoid cross-references between review responses.
- Still maintain an internal merged-concern table to ensure consistency.
- Character limits are per-response, not global — budget each response independently.

### Rolling review venues (ARR, TMLR)

- Invest more in revision planning than argumentation.
- After round 1, shift to: "Here is what we changed" rather than "Here is why we were right."
- Long argumentative exchanges are explicitly low-value (ARR guidance).

### Single-feedback venues (AAAI, The Web Conference)

- Assume one shot — no follow-up.
- Prioritize the 2-3 concerns most likely to surface in committee discussion.
- Make the AC's job easy: lead with a clear accept case.
