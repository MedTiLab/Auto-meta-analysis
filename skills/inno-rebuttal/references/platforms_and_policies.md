# Platforms And Policies

Last updated: 2026-03-24

Use this file when the task depends on platform mechanics or policy constraints rather than pure writing.

## OpenReview mechanics

OpenReview supports multiple rebuttal configurations:

- one rebuttal per paper,
- one rebuttal per review,
- multiple rebuttals per paper.

Default forms are text-first:

- default rebuttal form: markdown text, default length limit 2500 characters,
- default comment form: markdown text, default length limit 5000 characters.

Actual conferences often override these defaults.

Sources:
- Rebuttal stage reference: https://docs.openreview.net/reference/stages/rebuttal-stage
- Default rebuttal form: https://docs.openreview.net/reference/default-forms/default-rebuttal-form
- Default comment form: https://docs.openreview.net/reference/default-forms/default-comment-form

## Review dimension patterns

OpenReview default review forms and major ML conferences converge on a similar set of axes:

- quality or technical soundness
- clarity
- originality or novelty
- significance

This is a good cross-venue abstraction layer for review parsing.

Sources:
- OpenReview default review form: https://docs.openreview.net/reference/default-forms/default-review-form
- NeurIPS 2025 Reviewer Guidelines: https://neurips.cc/Conferences/2025/ReviewerGuidelines

## LLM usage policies relevant to rebuttal drafting

### ICLR 2026

- Significant LLM use in research ideation or writing must be disclosed.
- Authors remain responsible for all content.
- Missing disclosure can trigger desk rejection.

Sources:
- ICLR 2026 Author Guide: https://iclr.cc/Conferences/2026/AuthorGuide
- ICLR blog policy note: https://blog.iclr.cc/2025/08/26/policies-on-large-language-model-usage-at-iclr-2026/

### NeurIPS 2025

- LLM use by authors is allowed.
- Transparency and author responsibility still apply.

Source:
- NeurIPS 2025 LLM policy: https://neurips.cc/Conferences/2025/LLM

### TMLR

- LLM use is allowed.
- Authors remain responsible.
- Disclosure is recommended in a first-page footnote.

Sources:
- TMLR FAQ: https://jmlr.org/tmlr/faq.html
- TMLR editorial policies: https://www.jmlr.org/tmlr/editorial-policies.html

### ICML 2025 reviewer-side restriction

- Reviewers must not submit papers or reviews to generative AI systems.

This matters for reviewer workflow policy checks, but not as author permission to draft a rebuttal.

Source:
- ICML 2025 Reviewer Instructions: https://icml.cc/Conferences/2025/ReviewerInstructions

## Common policy checks to surface in the skill

- anonymity constraints
- external link restrictions
- whether new experiments or new results are allowed
- whether revised PDFs are allowed during discussion
- whether a confidential note to AC is available
- whether LLM usage or assistance must be disclosed

## Guardrails the skill should enforce

- Never invent experiments, scores, or reviewer positions.
- Never fabricate section numbers or claim manuscript changes that were not made.
- Warn when a venue prohibits external links, deanonymizing details, or oversized rebuttal artifacts.
- Warn when the venue's LLM policy may require disclosure.
