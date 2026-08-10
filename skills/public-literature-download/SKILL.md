---
name: public-literature-download
description: >
  Legal public literature full-text download skill for medical systematic reviews and Meta-analysis. It resolves PMID/DOI/PMCID identifiers, checks PMC/OA availability, downloads allowed PDF/HTML/Markdown/text or archive resources, records failures, and avoids publisher scraping or paywall bypass.
stage: Literature acquisition
domain: medical
tags:
  - PubMed
  - PMC OA
  - open access
  - PDF download
  - systematic review
  - references
  - Zotero
---

# Public Literature Full-Text Download

## Purpose

Download literature files only from lawful, documented, public or user-owned sources and create reproducible full-text manifests for Meta-analysis projects.

This skill fills the missing Meta-analysis workflow gap between citation management and full-text parsing/conversion.

## Hard rules

- Do not scrape publisher sites.
- Do not bypass paywalls or access controls.
- Do not use Sci-Hub, shadow libraries, leaked credentials, or browser automation to evade terms.
- Prefer user-owned Zotero PDFs, project-uploaded full-text assets, and official public repositories for records already in the explicit full-text acquisition queue.
- Follow the Meta full-text acquisition priority: first open-source/public repository copies, then open-access journal copies, and finally non-OA journal records. Non-OA journal records are only logged for manual upload, library access, author contact, or Zotero handoff; they must not be downloaded through paywall bypass or publisher scraping.
- Record every failed or unavailable item with a clear reason.

## Preferred sources

1. Existing project PDFs under `04_full_text_review/fulltext/`, `04_full_text_review/uploads/`, `00_literature/references/attachments/`, legacy `Experiment/analysis/pdf/raw/`, or user-uploaded folders.
2. Zotero-owned attachments through the existing MedAutoData `references` integration.
3. Open-source/public repository copies: PMC, Europe PMC, PubMed Central OA, arXiv/medRxiv/bioRxiv preprints, institutional repositories, funder repositories, or other official public archives.
4. Open-access journal copies from official journal pages or OA APIs when the article is clearly OA and terms allow download.
5. PMC ID Converter for PMID/DOI/PMCID mapping.
6. PMC OA Web Service for downloadable OA resources, especially `format=pdf` when available.
7. PMC OAI-PMH / PMC FTP / official cloud resources for large-scale full-text retrieval.
8. OpenAlex metadata or full-text/PDF API only when credentials and allowed usage are configured.
9. Official open HTML/Markdown/text full text when a PDF is unavailable; do not save paywalled landing pages.
10. Non-OA journal records are last-priority records: record identifiers, journal, URL, and failure reason, then route them to manual upload/library/Zotero handoff rather than automated download.

## Inputs

Preferred input files:

- For numbered MedHelp Meta projects, use `04_full_text_review/fulltext_manifest.json/csv` as the acquisition queue. Title/abstract Claude/user `include` or `maybe` records are only eligible to be written into that queue; do not download every eligible record unless it is explicitly queued, usually with `needs_full_text: true`.
- For numbered MedHelp Meta projects, optional seed references from `00_literature/references/` are allowed only before formal search/dedupe; do not treat them as final screened records.

Legacy input files:

- `Literature/references/included_references.csv`
- `Literature/references/deduped_references.csv`
- `Literature/references/references.bib`
- `Experiment/datasets/full_text_screening.csv`
- `Experiment/datasets/included_studies.csv`
- A CSV with any of these columns: `pmid`, `PMID`, `pmcid`, `PMCID`, `doi`, `DOI`, `title`, `year`, `journal`
- A JSON list of reference objects with the same fields

## Outputs

For numbered MedHelp Meta projects, write outputs to:

```text
04_full_text_review/fulltext/<reference-id-slug>/<paper-title>.pdf
04_full_text_review/fulltext/<reference-id-slug>/<paper-title>.html
04_full_text_review/fulltext/<reference-id-slug>/<paper-title>.md
04_full_text_review/fulltext/<reference-id-slug>/<paper-title>.txt
04_full_text_review/fulltext_manifest.json
04_full_text_review/fulltext_manifest.csv
04_full_text_review/pdf_manifest.json
04_full_text_review/pdf_manifest.csv
04_full_text_review/pdf_acquisition_log.md
```

Manifest fields:

- `input_index`
- `reference_id`
- `needs_full_text`: `true` for records that should be acquired, queried in Zotero, uploaded, parsed, and screened at full text
- `pmid`
- `pmcid`
- `doi`
- `title`
- `status`: `downloaded`, `exists`, `dry_run`, `no_identifier`, `no_pmcid`, `no_oa_pdf`, `not_oa`, `failed`
- `asset_type`: `pdf`, `html`, `markdown`, or `text`
- `source`: `project`, `zotero`, `pmc_oa`, `pmc_tgz`, `openalex`, `user_uploaded`
- `url`
- `path`
- `reason`
- `checked_at`

MinerU should later write parsed output beside each PDF; Markdown/text can be registered directly, and HTML should be converted to basic Markdown:

```text
04_full_text_review/fulltext/<reference-id-slug>/mineru/<paper-title>.md
```

If automatic acquisition fails, mark the item as `manual_upload_required`; the app full-text upload action saves the user-provided PDF, Markdown, HTML, or text to the same title-named location.

For legacy Meta projects, keep using:

```text
Experiment/analysis/pdf/raw/
Experiment/analysis/pdf_manifest.json
Experiment/analysis/pdf_manifest.csv
```

## Default command

```bash
python skills/public-literature-download/scripts/pmc_oa_downloader.py \
  --input 03_title_abstract_screening/screening_decisions.csv \
  --output-dir 04_full_text_review/fulltext \
  --manifest 04_full_text_review/fulltext_manifest.json \
  --summary-csv 04_full_text_review/fulltext_manifest.csv \
  --reference-dir-layout \
  --tool medautodata_meta \
  --email YOUR_EMAIL@example.com
```

Use `--dry-run` before a large batch.

## Rate and batching guidance

- Batch PMC ID Converter requests in groups of at most 200 identifiers.
- Use `--delay 0.34` or slower by default for NCBI/PMC requests.
- For large jobs, run outside peak hours and avoid concurrent requests.
- For many thousands of papers, use official PMC OAI-PMH / FTP / cloud resources rather than repeated per-record calls.

## Integration with Meta-analysis workflow

After downloading:

1. Update `04_full_text_review/fulltext_manifest.json` and, for compatibility, `04_full_text_review/pdf_manifest.json` for PDF rows.
2. Update `.pipeline/docs/research_brief.json` or `04_full_text_review/pdf_acquisition_log.md` with counts: downloaded, exists, no OA PDF, failed.
3. Pass `downloaded` and `exists` PDFs to MinerU; register Markdown/text directly and convert official open HTML to Markdown.
4. Keep `manual_upload_required`, `no_oa_pdf`, and `failed` records in full-text screening notes for manual upload or exclusion decisions.

For new MedHelp Meta projects, never create `MetaAnalysis/`, `Survey/meta-analysis`, or a nested `meta-analysis/` directory. Use `00_literature/` for preliminary literature review/topic selection, `02_search_dedupe/` for formal reference inputs, `03_title_abstract_screening/` for screening decisions, and `04_full_text_review/` for full-text manifests and downloaded/uploaded files.

## Output contract for downstream MinerU parsing

Downstream full-text screening should read `fulltext_manifest.json` plus parsed Markdown/HTML/text outputs and process only records where:

```json
{
  "status": "downloaded"
}
```

or

```json
{
  "status": "exists"
}
```

The parser must write a separate `parse_manifest.json` and should not mutate `pdf_manifest.json` except by appending checksum information.
