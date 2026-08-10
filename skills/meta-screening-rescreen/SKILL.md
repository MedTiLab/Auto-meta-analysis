---
name: meta-screening-rescreen
description: >
  Use this skill for MedHelp Meta-analysis staged screening: title/abstract AI first screen,
  title/abstract AI second screen, optional one-time catch-up audit, full-text AI first/second
  screen, conflict checks, and progress handoff. It preserves user override decisions without
  making user rescreening a default gate, writes audit outputs under the matching
  03_title_abstract_screening or 04_full_text_review subfolder, and updates the canonical
  screening_decisions.csv/json state with stage-specific records.
allowed-tools: [Read, Write, Edit, Bash]
---

# Meta Staged Screening

Use this skill after `02_search_dedupe/screening_input.csv` has been created for title/abstract screening, and again after Zotero-synced full text is available for full-text screening.

## Folder contract

Keep the right-side file tree explicit:

```text
03_title_abstract_screening/
  screening_decisions.csv        # canonical UI sync state
  screening_decisions.json       # optional canonical UI sync state
  01_ai_pre_screen/              # first-pass AI queue, rubric, reports
  02_agent_rescreen/             # named-AI second pass, conflicts, optional catch-up audit
04_full_text_review/
  fulltext_manifest.json         # full-text availability and handoff queue
  fulltext/                      # synced PDFs, Markdown, HTML, and text assets
  full_text_screening_audit.md   # optional concise full-text audit log
```

`03_title_abstract_screening/screening_decisions.csv` or `.json` remains the single final decision source for the smart-screening page. Use `stage: "title_abstract"` for title/abstract decisions and `stage: "full_text"` for full-text decisions. Title/abstract subfolder files and full-text logs are audit/progress artifacts.

## Workflow

1. Read project memory (`AGENTS.md` or `CLAUDE.md`) and follow the Meta directory and source-routing rules.
2. For title/abstract first screen, read `02_search_dedupe/screening_input.csv` and write `stage: "title_abstract"` records with `reviewer: "ai_pre_screen"` plus audit files under `03_title_abstract_screening/01_ai_pre_screen/`.
3. For title/abstract second screen, build an AI queue from `stage: "title_abstract"` records. Prioritize `maybe`, low confidence, missing reasons, high-impact include/exclude calls, and suspected false decisions; include all records when scale and token budget allow. Do not turn this into a user/manual review queue.
4. For full-text first screen, read `04_full_text_review/fulltext_manifest.json`/`.csv` plus parsed Markdown, HTML-derived Markdown, or text materials under `04_full_text_review/fulltext/`, then write `stage: "full_text"` records with `reviewer: "ai_pre_screen"` to the canonical screening decision file. Keep any concise full-text audit logs under `04_full_text_review/`; do not create `04_full_text_review/01_ai_pre_screen/`.
5. For full-text second screen, build an AI queue from `stage: "full_text"` records needing review. Do not require users to manually rescreen full-text records by default.
6. Run the Claude second pass with `reviewer: "claude"` from the current capable agent session. Do not require launching a separate backend agent unless the caller explicitly orchestrates one. Do not overwrite `reviewer: "user"` decisions.
7. Write title/abstract second-screen audit files under `03_title_abstract_screening/02_agent_rescreen/`; for full text, keep concise audit files directly under `04_full_text_review/` with clear `full_text_` filenames instead of creating `02_agent_rescreen/`:
   - `rescreen_queue.csv`
   - `rescreen_decisions.csv` or `.json`
   - `conflicts.csv`
   - `rescreen_report.md`
8. If stability still looks weak after the named-AI second pass, run at most one catch-up audit focused on false exclusions, missing PICO matches, and inconsistent reasons. For title/abstract, write `catchup_candidates.csv`, `catchup_decisions.csv` or `.json`, and `catchup_report.md` in `03_title_abstract_screening/02_agent_rescreen/`; for full text, write the same concise audit files directly under `04_full_text_review/` with `full_text_` prefixes.
9. Update the canonical `03_title_abstract_screening/screening_decisions.csv/json` with the latest stage-specific records, then sync artifacts if the API is available.

## Decision rules

- Use `include`, `exclude`, or `maybe`.
- `maybe` is preferred when PICO fit, study design, outcome relevance, or abstract evidence is uncertain.
- Preserve `reason`, `evidenceNote`, `confidence`, `reviewer`, and source identifiers (`pmid`, `doi`, title).
- If AI pre-screen and named-AI second-screen decisions differ, record the item in `conflicts.csv` for audit and optional catch-up. Do not create a large default user-confirmation queue; surface only a concise high-risk subset if user spot-checking is needed.
- Title/abstract include/maybe from the named-AI second screen, or explicit `reviewer: "user"` overrides, only make a record eligible for the missing-full-text queue. The record must still be written to `04_full_text_review/fulltext_manifest.json/csv` with `needs_full_text: true`; run lawful download/acquisition with `legal-pdf-acquisition` and `public-literature-download` first, and push only records that remain incomplete to Zotero through `meta-zotero-fulltext-handoff`. Title/abstract AI pre-screen alone should normally be followed by AI second screen before advancing.
- Full-text include/maybe from the named-AI second screen can advance to extraction/quality review. Full-text AI pre-screen alone should normally be followed by AI second screen before advancing.
- `reviewer: "user"` is an explicit user override or spot-check result only. Preserve it, report conflicts against it, and do not treat user confirmation as a routine screening gate.
