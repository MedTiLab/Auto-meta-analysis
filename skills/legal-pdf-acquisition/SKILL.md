---
name: legal-pdf-acquisition
description: Resolve legally available full-text assets for MedHelp Meta projects using existing project files, Zotero attachments, user uploads, PMC/Europe PMC, Unpaywall, or official open-access links. Assets may be PDF, Markdown, HTML, or text.
allowed-tools:
  - Read
  - Write
  - Bash
---

# Legal Full-Text Acquisition

## Purpose

Use this skill to solve full-text acquisition difficulties without violating copyright or access rules. It is the policy and routing layer for acquiring PDF, Markdown, HTML, or text full text; use `public-literature-download` for conservative public/OA batch downloads.

## Allowed sources

Priority order:

1. existing MedHelp/MedAutoData PDF cache;
2. Zotero stored attachment for records already in the explicit full-text acquisition queue;
3. user-uploaded PDF, Markdown, HTML, or text;
4. PubMed Central / PMC;
5. Europe PMC;
6. Unpaywall open access PDF;
7. official open-access HTML/Markdown/text full text when PDF is unavailable and the source is clearly public/open;
8. publisher open-access PDF when it is clearly open access and allowed;
9. user-mediated institutional access, followed by manual upload.

## Forbidden

Do not implement:

- Sci-Hub integration;
- shadow library downloads;
- paywall bypass;
- credential sharing;
- automated institutional login scraping.

## Status values

Use:

- `not_checked`
- `cached`
- `zotero_attachment_found`
- `pmc_found`
- `europe_pmc_found`
- `unpaywall_found`
- `downloaded`
- `manual_upload_required`
- `institution_login_required`
- `unavailable`
- `failed`

## Metadata

For every full-text asset save:

- source;
- status;
- file path;
- asset type (`pdf`, `markdown`, `html`, or `text`);
- content type;
- original filename for uploads;
- source URL when resolved automatically;
- sha256;
- license or OA status when known;
- error message if failed.

## Project paths

For legacy Meta projects, write full-text acquisition artifacts under:

```text
Experiment/analysis/pdf/raw/
Experiment/analysis/pdf/uploads/
Experiment/analysis/pdf/zotero_attachments/
Experiment/analysis/pdf_manifest.json
Experiment/analysis/pdf_manifest.csv
Experiment/analysis/pdf_acquisition_log.md
```

For numbered MedHelp Meta projects, store resolved or uploaded full text in the app full-text folder using the literature title as the file stem:

```text
04_full_text_review/fulltext/<reference-id-slug>/<paper-title>.pdf
04_full_text_review/fulltext/<reference-id-slug>/<paper-title>.md
04_full_text_review/fulltext/<reference-id-slug>/<paper-title>.html
04_full_text_review/fulltext/<reference-id-slug>/<paper-title>.txt
04_full_text_review/fulltext/<reference-id-slug>/mineru/<paper-title>.md
04_full_text_review/fulltext_manifest.json
04_full_text_review/fulltext_manifest.csv
04_full_text_review/pdf_manifest.json
04_full_text_review/pdf_manifest.csv
04_full_text_review/pdf_acquisition_log.md
```

If no legal source is available, mark `manual_upload_required` and let the app full-text upload action place the user-provided PDF/Markdown/HTML/text file in that same title-named location.

Reference inputs for acquisition must come from `04_full_text_review/fulltext_manifest.json/csv` rows explicitly queued for full text, usually with `needs_full_text: true`. Title/abstract Claude/user `include` or `maybe` decisions are only eligibility to create this queue; do not download, query Zotero, upload, or parse every `include`/`maybe` record by default. Do not create `Survey/meta-analysis`, `MetaAnalysis/`, or a nested `meta-analysis/` folder.

## Handoff

- For Zotero attachment lookup, use `zotero-medautodata-library`.
- For PMC OA batch download, use `public-literature-download`.
- For parsing downloaded or uploaded PDFs, use `mineru-pdf-parser`; Markdown/text are directly readable, and HTML should be saved and converted to basic Markdown before full-text screening.
