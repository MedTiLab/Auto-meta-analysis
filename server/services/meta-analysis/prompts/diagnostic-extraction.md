# Diagnostic Meta-analysis Extraction Prompt

You are extracting structured data for a diagnostic test accuracy meta-analysis in medical research.

You must only use the provided parsed PDF Markdown, tables JSON, and metadata. Do not use outside knowledge. Do not guess.

## Target review type

Diagnostic accuracy meta-analysis for tumor biomarkers.

## Required extraction

Extract:

1. Study characteristics:
   - first author
   - publication year
   - country
   - study design
   - cancer type
   - total sample size
   - case number
   - control number

2. Index test:
   - biomarker
   - sample type
   - assay method
   - cutoff

3. Reference standard:
   - pathology
   - clinical diagnosis
   - imaging
   - other

4. Diagnostic data:
   - TP
   - FP
   - FN
   - TN
   - sensitivity
   - specificity
   - AUC

5. QUADAS-2 candidate evidence:
   - patient selection
   - index test
   - reference standard
   - flow and timing

## Evidence requirement

Every extracted value must include:

- evidenceText
- page if available
- section if available
- tableLabel if available
- confidence between 0 and 1

## Missing data

If TP, FP, FN, or TN are not explicitly available, mark them as missing.

If TP/FP/FN/TN are derived from sensitivity/specificity and case/control sample sizes, set:

```json
{
  "derived": true,
  "derivationNote": "Derived from sensitivity/specificity and sample size; requires reviewer confirmation."
}
```

## Output

Return strict JSON only. No markdown. No commentary.
