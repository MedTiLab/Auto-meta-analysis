---
name: meta-zotero-fulltext-handoff
description: >
  Use this for MedHelp Meta projects when the current full-text stage has records whose usable
  full text is missing or incomplete. It updates the current missing-full-text gap list, pushes
  only incomplete records to the MedHelp Zotero collection, lets Zotero obtain/attach PDFs, then
  syncs attachments or decisions back without broad AI-generated import files.
allowed-tools:
  - Read
  - Write
  - Bash
---

# Meta Zotero Full-Text Handoff

Use this skill when a Meta project needs full text and the local project does not already have a usable PDF, Markdown, HTML, or text asset.

## Core rule

Do not run broad in-app full-text acquisition. Do not ask the AI to create large import files and expect the user to import them manually. For missing or incomplete full text, hand off the specific records to Zotero and let Zotero manage PDF retrieval and attachments.

For Meta full-text acquisition priority, try legal open-source/public repository copies first, then official OA journal copies. Non-OA journal records come last and should be routed to Zotero, library access, author contact, or manual upload; do not scrape publisher pages or bypass paywalls for them.

## What counts as incomplete

A record needs handoff only if it is in the Meta full-text need set and lacks a usable local asset:

- no file under `04_full_text_review/fulltext/<reference-id-slug>/`;
- no cached or downloaded asset recorded for the reference;
- an existing asset is marked failed, unavailable, or missing attachment;
- parsed Markdown exists but is clearly partial, corrupted, or unrelated to the target paper.

Do not push records that already have a usable local full-text asset.

## Required queue

The full-text need set must come from the current Meta full-text stage, not from all project references:

1. Read the existing `04_full_text_review/fulltext_manifest.json` or `.csv` first when it exists.
2. Reconcile the manifest with local assets under `04_full_text_review/fulltext/`, any parse-quality notes, and `stage: "full_text"` records in `03_title_abstract_screening/screening_decisions.csv` or `.json`.
3. If the manifest is missing or stale, update it from the current project state and the current full-text gap records. Title/abstract include/maybe records can help seed the queue, but they are not a hard Zotero handoff rule.
4. Mark only records that still lack usable local full text with `needs_full_text: true`.
5. Filter that manifest to only incomplete records before pushing to Zotero.

Do not stop solely because a title/abstract AI second screen is absent. This step belongs to full-text availability work: update the gap list, skip records that already have usable full text, and push only records that remain incomplete. Do not frame this action as full-text second screening.

## Zotero handoff

Preferred path:

1. Export the incomplete manifest records to an RIS reference-management file first.
2. Import that RIS file into Zotero, then attach or retrieve PDFs for the imported bibliographic items.
3. If RIS import fails, pause the automated handoff immediately. Do not keep trying other automatic import paths. Write the RIS file and a short manual-import note, then ask the user to import it manually in Zotero.

Use the MedHelp API when it is available to support this workflow:

```text
POST /api/meta-analysis/:metaProjectId/full-text/zotero/export
```

Credential preflight:

- This export uses the Zotero Web API, not only the local Zotero desktop API.
- In agent/AI CLI sessions, read credentials and MedHelp API access from environment variables first:
  - `ZOTERO_API_KEY`
  - `ZOTERO_USER_ID`
  - `MEDHELP_API_BASE_URL`
  - `MEDHELP_API_TOKEN` or `MEDHELP_AUTHORIZATION`
- `MEDHELP_API_TOKEN` is the current user's JWT. Call MedHelp endpoints with `Authorization: Bearer $MEDHELP_API_TOKEN`, or use `MEDHELP_AUTHORIZATION` directly when it is present. Do not ask the user to manually generate a JWT unless these env vars are missing.
- Before export, check whether active `zotero_api_key` and `zotero_user_id` credentials are configured for the current user.
- If credentials are missing, explicitly ask the user to create or paste a Zotero API key from:

```text
https://www.zotero.org/settings/keys/new
```

- The key must allow Zotero library access and write permission. File access is recommended when uploading existing local assets as attachments.
- Save the key through the app credential flow so it is recorded on the user's account for future runs; do not write it into project files, prompts, reports, or logs.
- Prefer the app flow that validates the key with Zotero, resolves `userID`, and stores both `zotero_api_key` and `zotero_user_id`.

## Verified push preflight

Before calling the Zotero export endpoint, verify these items in order. These are the actual gates used by the MedHelp export path:

1. MedHelp backend is reachable at `MEDHELP_API_BASE_URL`.
2. Zotero Web API credentials are available in env or the user's credential store.
3. A current-user MedHelp bearer token is available in `MEDHELP_API_TOKEN` or `MEDHELP_AUTHORIZATION`.
4. `04_full_text_review/fulltext_manifest.json` or `.csv` is non-empty and has `needs_full_text: true` rows for the records to push.
5. Every manifest row can match a record in `references_library` by `reference_id`, DOI, PMID/source, or title.
6. Every matched reference is linked through `project_references` using `meta_projects.project_id`, which points to `projects.id`. Do not use `meta_projects.id` as `project_references.project_id`.
7. `meta_screening_decisions` contains an authorization row for each pushed reference: `stage: "title_abstract"`, `reviewer` one of `claude` or `user`, and `decision` one of `include` or `maybe`.

If the API returns `skippedAcquisitionQueue`, inspect missing `references_library` records and `project_references` links. If it returns `skippedScreeningAuthorization`, inspect `meta_screening_decisions`; file-only decisions in `03_title_abstract_screening/screening_decisions.json` are not enough for the export gate unless they have been synced into the database.

Database note: the running app normally uses `~/.medhelp/auth.db` unless `DATABASE_PATH` overrides it. Do not assume `server/database/auth.db` is the active database.

Pass `referenceIds` only for incomplete manifest records. The endpoint creates or reuses items in:

```text
MedHelp/<Meta project title>/04 Full Text Review/Needs Review
```

Expected result:

- a RIS import/export artifact is available for Zotero handoff or manual fallback;
- ready local assets, if any, are uploaded as Zotero attachments;
- missing records are tagged `medhelp:fulltext-missing`;
- bibliographic items are available for Zotero's PDF retrieval workflow;
- a `04_full_text_review/zotero_handoff_report.json` audit file is written.

Operational note:

- The Zotero Web API can rate-limit large batches. If a run reports HTTP 429, do not treat the records as bad data; wait and rerun the same handoff or retry in smaller batches. Existing Zotero export records are reused.
- Prefer RIS export/import as the bibliographic handoff format. The model may orchestrate the handoff and retry logic, but it must pause on RIS import failure and switch to manual-import instructions instead of silently trying another automatic route.
- When the user starts the in-app "AI 推送" / Zotero communication action, the model is responsible for checking env, manifest, database gates, calling the API workflow, reading `04_full_text_review/zotero_handoff_report.json`, and summarizing the key counts in chat. Do not surface long report text, collection paths, or screening directory rules in the right-side project UI.

API call pattern:

```bash
curl -sS \
  -H "Authorization: Bearer ${MEDHELP_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"referenceIds":["pubmed_42138587"]}' \
  "${MEDHELP_API_BASE_URL}/api/meta-analysis/${META_PROJECT_ID}/full-text/zotero/export"
```

If the API is not available, write a small fallback queue instead:

```text
04_full_text_review/zotero_handoff_queue.ris
04_full_text_review/zotero_handoff_queue.csv
04_full_text_review/zotero_handoff_queue.json
```

The RIS file is the preferred fallback import artifact. Include only `reference_id`, `title`, `doi`, `pmid`, `year`, `journal`, `url`, and `reason` in CSV/JSON companions. State clearly that no Zotero push occurred and that the user should manually import the RIS file into Zotero.

## After Zotero retrieves PDFs

When Zotero has attached PDFs, sync back by one of these routes:

- use the local Zotero attachment resolver for the same manifest records;
- use `POST /api/meta-analysis/:metaProjectId/full-text/resolve-batch` with `sources: ["zotero"]`;
- if screening decisions were made in Zotero collections, use `POST /api/meta-analysis/:metaProjectId/full-text/zotero/import-decisions`.

Only after attachments are present should parsing continue with `mineru-pdf-parser` or direct Markdown/HTML/text conversion.

## Do not do

- Do not scrape paywalled publisher pages or bypass institutional login.
- Do not search Sci-Hub or shadow libraries.
- Do not push every include/maybe record when some already have full text.
- Do not create project-specific screening CSVs outside the canonical screening files.
- Do not overwrite `reviewer: "user"` screening decisions.

## Handoff summary

End with a concise status:

```text
Zotero handoff status
- Incomplete full-text records pushed:
- Already complete and skipped:
- Zotero collection:
- Missing identifiers:
- Next action after Zotero attaches PDFs:
```
