---
name: prisma-manuscript-writer
description: Generate PRISMA-style manuscript sections for MedHelp systematic reviews and Meta analyses using recorded searches, screening decisions, extraction data, and statistical outputs.
allowed-tools:
  - Read
  - Write
---

# PRISMA Manuscript Writer

## Purpose

Use this skill to draft manuscript sections from verified project records.

Use `prompts/methods-template.md` and `prompts/discussion-template.md` when drafting those sections.

## Sections

- Introduction
- Methods
- Results
- Discussion
- Conclusion
- Abstract placeholder

Write outputs to:

```text
09_manuscript_submission/
08_results_figures/
```

Do not create `Survey/meta-analysis`, `MetaAnalysis/`, or a nested `meta-analysis/` folder.

## Methods must use real project records

Use:

- exact databases;
- exact query;
- search date;
- result counts;
- screening decisions;
- extraction schema;
- risk-of-bias tool;
- statistical model.

Do not invent missing information.

## Results must use computed outputs

Use:

- dataset row count;
- analysis output JSON;
- figure paths;
- excluded records;
- heterogeneity results.

Do not invent numbers.

If required counts or model outputs are missing, insert explicit placeholders marked `TODO_SOURCE_REQUIRED` and list the missing artifact path or upstream task.

## Discussion structure

1. Principal findings.
2. Comparison with prior studies.
3. Biological or clinical mechanism.
4. Clinical implications.
5. Strengths.
6. Limitations.
7. Future research.
8. Conclusion.

Before finalizing, run a consistency pass against PRISMA 2020 items, the search log, screening counts, extraction review status, and statistical output JSON.
