---
name: local-database-api-access
description: Use when any task needs the MedHelp local database API — checking or starting the service, listing the 23 sources, searching variables, resolving data keys, inspecting schema, building/extracting datasets, or downloading CSV. Covers local passwordless (same-host, no token) and remote (Bearer) modes through one base URL.
---

# Local Database API Access

This is the **shared base skill** for all MedHelp database work. Every per-database skill (`$nhanes-database-access`, `$charls-database-access`, …) is a thin wrapper; **startup, base-URL detection, auth, endpoint shapes, the Python client, and the query→extract→download flow all live here.** When in doubt, follow this file.

> **Golden path (memorize this):** detect base URL → query variables → (optional) resolve/schema → extract a small dataset → download CSV. **Query first, extract last.**

---

## 0. 30-Second Quickstart (local passwordless mode)

On the same machine as the service, **no token is needed.** Copy-paste this whole block:

```bash
# 1) Find the running service (sets $BASE). See §1 for how this works.
BASE=""
for u in "$MEDHELP_DATABASE_API_URL" http://127.0.0.1:8787 http://127.0.0.1:8878; do
  [ -n "$u" ] && curl -fs -m 3 "$u/api/v1/health" >/dev/null 2>&1 && { BASE="$u"; break; }
done
echo "BASE=$BASE"   # if empty, the service is not running → see §6 Start/Restart

# 2) List the 23 sources
curl -sS "$BASE/api/v1/sources"

# 3) Search variables (POST JSON; works for English AND Chinese terms)
curl -sS -X POST "$BASE/api/v1/variables/query" \
  -H 'Content-Type: application/json' \
  -d '{"query":"BMI 体重指数","source":"nhanes","limit":10}'

# 4) Build a small dataset (returns a dataset id + downloadUrl)
curl -sS -X POST "$BASE/api/v1/extract" \
  -H 'Content-Type: application/json' \
  -d '{"source":"nhanes","selected":["BMXBMI"],"projectName":"nhanes_bmi_demo","rowCap":20}'

# 5) Download the CSV (use the downloadUrl from step 4)
curl -L -o dataset.csv "$BASE/api/v1/datasets/<dataset_id>/download"
```

If any call returns `Access token required`, you are NOT on the local base — re-run step 1 and make sure `$BASE` is `http://127.0.0.1:...`. **Do not ask the user for a token in local mode.**

---

## 1. Base URL — always detect, never hardcode

There is **one HTTP entry point** (the Node app). It may run on different ports across installs, so **detect it; do not assume a port.**

Resolution order (the loop in §0 does exactly this):

1. `$MEDHELP_DATABASE_API_URL` if set and its `/api/v1/health` answers.
2. `http://127.0.0.1:8787`  ← current local-dev default.
3. `http://127.0.0.1:8878`  ← common packaged/production default.
4. None answer → the service is down. Go to §6.

Remote/public callers use `https://api.medtimehelp.com` (token required — see §2).

A healthy base returns:

```json
{"ok":true,"service":"medhelp-api","version":"v1","authentication":{"required":true,...},
 "endpoints":{"health":"GET /api/v1/health","sources":"GET /api/v1/sources", ...}}
```

> Note: `authentication.required:true` only means "auth is not globally disabled." In **local passwordless mode** (trusted-local), same-host requests are still accepted **without a token** — verified by simply calling `GET /api/v1/sources` and getting data back.

---

## 2. Auth — local = no token; remote = Bearer (never print it)

| Where you call from | Base URL | Token? |
| --- | --- | --- |
| Same host as the service (AI agent on the server) | `http://127.0.0.1:<port>` | **No token.** Just call. |
| Remote / over the internet | `https://api.medtimehelp.com` | **Bearer required** (login or PAT) |

Rules:

- In local mode, **never ask the user for a token, never add an `Authorization` header.** If you hit `Access token required`, you are on the wrong base or path — fix the base (§1), use `/api/v1/*`.
- For remote calls, only use a token that is **already in the environment** (`$MEDHELP_DATABASE_API_TOKEN`). **Never paste, echo, log, or print the token.**
- Personal Access Tokens (PATs, prefix `mdpat_`) have **data scope only**: they can query / build / list / download via `/api/v1/*` but cannot touch `/api/auth/*`, `/api/ai/*`, admin routes, or delete datasets.

---

## 3. Two API surfaces — know which one to use

Both are served through the same base URL. **Default to Surface A.** Use Surface B only to inspect a specific physical file before extracting, or for maintenance.

### Surface A — high-level `/api/v1/*`  ← use this for normal AI work

| Method & path | Purpose |
| --- | --- |
| `GET /api/v1/health` | service info + endpoint index |
| `GET /api/v1/openapi.json` | machine-readable API description |
| `GET /api/v1/sources` | list 23 sources: `{id,name,profileType,sourceRoot}` |
| `GET\|POST /api/v1/variables/query` | ranked variable candidates (one or many sources) |
| `POST /api/v1/extract` *(alias `POST /api/v1/datasets/build`)* | build a dataset CSV from selected variables or a query |
| `GET /api/v1/datasets` | list datasets you have built |
| `GET /api/v1/datasets/{id}` | dataset detail + preview |
| `GET /api/v1/datasets/{id}/download` | download the CSV |

### Surface B — low-level sidecar (advanced; the bundled Python client speaks this)

These have **no `/api/v1` prefix.** They expose the raw index/resolver/schema/extract of the Python sidecar.

| Method & path | Purpose |
| --- | --- |
| `GET /health` | sidecar health (`canonical_url`, `query_root`) |
| `GET /sources` | sidecar source list |
| `GET /docs` | externally verifiable reference docs |
| `GET /manifest?source=<id>` | a source's manifest (its query/index files) |
| `POST /search` | raw ranked search: `{q,source,kind,match,limit}` |
| `POST /search/batch` | multi-term raw search |
| `GET /resolve?source=<id>&file=<key>` | resolve a candidate data key to a real file |
| `GET /schema?source=<id>&file=<key>&object=<opt>` | columns of a resolved file |
| `GET /extract?source=<id>&file=<key>&columns=<a,b>&limit=&format=json\|csv` | pull rows from ONE specific file |
| `GET /refresh`, `GET /admin` | **admin-gated — skip in normal local work** |

> **Do not mix the two extract shapes.** Surface A extract takes `{source, selected:[codes], projectName, rowCap}` and produces a stored, downloadable dataset. Surface B extract takes `?file=&columns=` and streams rows from one physical file. If you only need analysis-ready data, use Surface A.

---

## 4. Verified copy-paste recipes

All examples assume `$BASE` is set (see §0). All outputs below are real shapes from a live local service.

### 4.1 List sources

```bash
curl -sS "$BASE/api/v1/sources"
# → {"ok":true,"sources":[{"id":"cfps","name":"CFPS","profileType":"survey_panel",...}, ... 23 items]}
```

### 4.2 Query variables (single source)

```bash
curl -sS -X POST "$BASE/api/v1/variables/query" \
  -H 'Content-Type: application/json' \
  -d '{"query":"blood pressure 血压","source":"charls","limit":20}'
```

Request fields: `query` (required, multilingual OK), `source` (one id) **or** `sources` (array), `limit`, `perSourceLimit`, `kind` (default smart), `match` (`all`|`any`).
Response: `{ok, query, count, candidates:[{rank, source, ...code/label fields...}], bySource:{...}}`.

### 4.3 Query variables across several candidate sources

```bash
curl -sS -X POST "$BASE/api/v1/variables/query" \
  -H 'Content-Type: application/json' \
  -d '{"query":"BMI body mass index 体重指数","sources":["nhanes","ukb","charls"],"perSourceLimit":10}'
```

### 4.4 Build a dataset — explicit variable codes

```bash
curl -sS -X POST "$BASE/api/v1/extract" \
  -H 'Content-Type: application/json' \
  -d '{"source":"nhanes","selected":["BMXBMI"],"projectName":"nhanes_bmi_demo","rowCap":20}'
```

Returns (trimmed):

```json
{"ok":true,"status":"partial","datasets":[{
  "id":"20260614144026_nhanes_bmi_demo",
  "rows":5,"columns":2,"columnNames":["SDDSRVYR","BMXBMI"],
  "resolvedVariables":["SDDSRVYR","BMXBMI"],"unresolved":[],
  "downloadUrl":"/api/v1/datasets/20260614144026_nhanes_bmi_demo/download",
  "detailUrl":"/api/v1/datasets/20260614144026_nhanes_bmi_demo",
  "preview":[{"SDDSRVYR":12,"BMXBMI":27}, ...]}]}
```

Always read back: `id`, `downloadUrl`, `columnNames`, `rows`, `unresolved`. If `unresolved` is non-empty or `statusLabel` is `部分成功`, some codes didn't resolve — re-check them via 4.2 or schema (§4.7).

### 4.5 Build a dataset — query-to-dataset mode (let the API pick variables)

```bash
curl -sS -X POST "$BASE/api/v1/extract" \
  -H 'Content-Type: application/json' \
  -d '{"source":"nhanes","query":"BMI","variablesPerSource":1,"projectName":"nhanes_bmi_demo","rowCap":100}'
```

### 4.6 List, inspect, download

```bash
curl -sS "$BASE/api/v1/datasets"                                   # list
curl -sS "$BASE/api/v1/datasets/<dataset_id>"                      # detail + preview
curl -L  -o dataset.csv "$BASE/api/v1/datasets/<dataset_id>/download"   # CSV
```

Prefer the `downloadUrl` returned by extract; otherwise build it as `/api/v1/datasets/<id>/download`.

### 4.7 (Advanced) Resolve a data key and inspect columns before extracting (Surface B)

```bash
curl -sS "$BASE/resolve?source=nhanes&file=<candidate_key>"        # confirm the file exists
curl -sS "$BASE/schema?source=nhanes&file=<resolved_file>"         # list real columns
```

Use this when a search row gives a `file`/`parquet_rel`/`data_path` candidate and you must confirm the exact columns before claiming data exists. The router skill (`$medhelp-local-database-router`) lists which fields to pull as candidate keys.

---

## 5. Bundled Python client (optional convenience)

A dependency-free stdlib client ships with this skill at:

```text
skills/local-database-api-access/scripts/local_db_api.py
```

It speaks **Surface B** (low-level) and auto-detects the base URL the same way as §1.

```bash
python3 <skill_dir>/scripts/local_db_api.py health
python3 <skill_dir>/scripts/local_db_api.py sources
python3 <skill_dir>/scripts/local_db_api.py search --source nhanes --q "BMI" --limit 5
python3 <skill_dir>/scripts/local_db_api.py resolve --source nhanes --file <candidate_key>
python3 <skill_dir>/scripts/local_db_api.py schema  --source nhanes --file <resolved_file>
python3 <skill_dir>/scripts/local_db_api.py extract --source nhanes --file <file> --columns SEQN,BMXBMI --limit 20 --format csv -o out.csv
```

Override the base with `--base-url` or `MEDHELP_DATABASE_API_URL`. **For building a stored, downloadable dataset, prefer Surface A curl (§4.4) over the client.**

> If you cannot locate `<skill_dir>`, just use the curl recipes in §4 — they need no script.

---

## 6. Start / Restart the service

First check whether it is already up (§0 step 1). Only start if no base answers.

### Local development (this machine)
The Node app + Python sidecar start together. From the app/repo root (where `server.js` and `database/` live):

```bash
# typical local dev:
node server.js          # serves the API on http://127.0.0.1:8787 (passwordless when trusted-local)
# or, if a deploy script is present:
bash database/start_deploy_api.sh
```

Re-check: `curl -sS "$BASE/api/v1/health"`.

### Production (Linux service)
Keep the Node app on `127.0.0.1` with the Python sidecar behind a Unix socket. Restart through the service manager so stale child processes/sockets are not reused:

```bash
sudo systemctl restart medtimehelp-web.service
curl -sS "https://api.medtimehelp.com/api/v1/health"
```

Do not expose a separate TCP database sidecar for normal production use.

---

## 7. Source IDs (23)

```text
cfps  cgss  charls  chfs  chip  chns  clds  clhls  css
eicu  elsa  hrs  klosa  lasi  mhas  share
nhanes  ukb
mimiciii  mimiciv  mimiciv31  nwicu  pic
```

For routing by topic/alias, names, and per-source notes, use [references/source-map.md](references/source-map.md) and the router skill `$medhelp-local-database-router`.

`gco-database-analysis` is **separate** — it uses local GCO/GLOBOCAN assets + official GCO API, not this 23-source API.

---

## 8. Troubleshooting (do this, not that)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `curl: (7) Failed to connect ... port` | service not on that port | re-run §0 step 1 (probe 8787 then 8878); if still empty, §6 start |
| `{"ok":false,"error":"Access token required"}` | you're on a non-local/public base, or an auth-only path | set `$BASE` to `http://127.0.0.1:<port>`, use `/api/v1/*`; **do not ask for a token** |
| `404` on `/api/v1/resolve` or `/api/v1/schema` | those are **Surface B** | drop the `/api/v1` prefix → `/resolve`, `/schema` |
| `403` on `/refresh` or `/admin` | admin-gated | skip; not needed for normal data work |
| empty `candidates` / `results` | terms too narrow | add EN+ZH synonyms, set `"match":"any"`, try other `kind`, or pass multiple `sources` |
| extract `统计 unresolved` non-empty / `部分成功` | some codes didn't resolve | re-check codes via §4.2 or schema §4.7; fix `selected` |
| Chinese terms return nothing via GET | URL-encoding issues | use **POST JSON** (§4.2), not GET query strings |

---

## 9. Hard rules (don't violate)

- **Query/index lookup before extraction.** Never extract from a guessed file or column.
- Use `/resolve` before claiming a dataset exists or is missing; use `/schema` before `/extract` when exact columns are uncertain.
- Keep extracts **small first** (`rowCap`/`limit` ~20) unless the user explicitly asks for a large export.
- **Do not invent** availability, row counts, values, field IDs, table names, labels, joins, waves, weights, or cycle semantics. Report only what the API returned.
- Always report: exact **source ID**, **endpoint + surface**, resolved **data key/file**, **columns**, **row limit**, and any **join / time / cycle / weight** warning.
- Do not scan workstation file paths directly for normal data work — go through the API.
