---
name: manuscript-editor
description: Edit and format Meta-analysis manuscripts for clarity, journal structure, PRISMA consistency, evidence traceability, and medical academic style.
allowed-tools:
  - Read
  - Write
---

# Manuscript Editor

## Purpose

Use this skill after Methods/Results/Introduction/Discussion drafts are generated.

Read source drafts from `Publication/manuscript/` and supporting tables/figures from `Publication/tables/`, `Publication/figures/`, and `Publication/supplementary/`.

## Editing levels

1. Proofreading: spelling, grammar, punctuation.
2. Copy editing: clarity, terminology, concision.
3. Line editing: flow, transition, paragraph logic.
4. Scientific editing: consistency with data and methods.
5. Format editing: headings, figure callouts, references placeholders.

## Rules

- Do not change statistical numbers unless source output changes.
- Do not add unsupported claims.
- Preserve PRISMA language.
- Flag missing citations and unsupported background claims.
- Maintain consistent terminology for disease, biomarker, assay, and outcomes.
- Check that every Results claim is backed by a table, figure, extraction row, or statistical output.
- Flag PRISMA count mismatches, missing exclusion reasons, missing risk-of-bias/quality appraisal, and unsupported clinical implications.

## Output

Write edited drafts or review notes under:

```text
Publication/manuscript/
Publication/supplementary/manuscript_audit.md
```

If a direct edit would change scientific meaning, leave a reviewer note instead of silently rewriting.
