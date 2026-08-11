# MedHelp Database API — Full Contract

Deep reference for the database-access skills. Call this API directly instead of opening the MedHelp app or reading raw data files. For the quickstart and decision rules, see [../SKILL.md](../SKILL.md); this file is the field-level contract.

---

## 1. Base URL (detect, don't hardcode)

One HTTP entry point (the Node app). Port varies across installs — **always detect**:

```bash
BASE=""
for u in "$MEDHELP_DATABASE_API_URL" http://127.0.0.1:8787 http://127.0.0.1:8878; do
  [ -n "$u" ] && curl -fs -m 3 "$u/api/v1/health" >/dev/null 2>&1 && { BASE="$u"; break; }
done
echo "BASE=$BASE"
```

- `http://127.0.0.1:8787` — current local-dev default.
- `http://127.0.0.1:8878` — common packaged/production default.
- `https://api.medtimehelp.com` — remote/public base (token required).

Optional env:

```bash
export MEDHELP_DATABASE_API_URL="${MEDHELP_DATABASE_API_URL:-http://127.0.0.1:8787}"
export DATABASE_API_CANONICAL_URL="${DATABASE_API_CANONICAL_URL:-https://api.medtimehelp.com}"
```

When a deployed service sets `DATABASE_API_CANONICAL_URL`, returned absolute `api_url`/`downloadUrl` values use the public base. If unset, treat returned URLs as **relative** and prefix with `$BASE`.

---

## 2. Auth

| From | Base | Token |
| --- | --- | --- |
| Same host (server-local AI) | `http://127.0.0.1:<port>` | **none** |
| Remote / internet | `https://api.medtimehelp.com` | Bearer required |

- Local same-host calls to `/api/v1/*` work **without a token** (trusted-local / passwordless). Verified by calling `GET /api/v1/sources` and receiving data.
- If a local call returns `Access token required`: confirm the base is `http://127.0.0.1:<port>` and the path starts with `/api/v1/`. **Do not ask the user for a token for same-host work.**
- Remote: only use a token already in the environment.

```bash
export MEDHELP_DATABASE_API_TOKEN=...   # remote only
# add to remote calls: -H "Authorization: Bearer $MEDHELP_DATABASE_API_TOKEN"
```

**Never paste, print, echo, or log the token.** PATs (`mdpat_…`) are data-scope only: query/build/list/download via `/api/v1/*`; no auth/AI/admin/delete.

---

## 3. Surface A — high-level `/api/v1/*` (default)

| Method & path | Body / query | Returns |
| --- | --- | --- |
| `GET /api/v1/health` | — | service info + endpoint index |
| `GET /api/v1/openapi.json` | — | OpenAPI document |
| `GET /api/v1/sources` | — | `{ok,sources:[{id,name,profileType,sourceRoot}]}` |
| `GET\|POST /api/v1/variables/query` | see §5 | ranked variable candidates |
| `POST /api/v1/extract` *(= `POST /api/v1/datasets/build`)* | see §6 | built dataset(s) + downloadUrl |
| `GET /api/v1/datasets` | `?source=&status=&from=&to=` | `{ok,datasets:[…],total}` |
| `GET /api/v1/datasets/{id}` | — | `{ok,meta,files,preview}` |
| `GET /api/v1/datasets/{id}/download` | — | CSV stream (`text/csv`) |

## 4. Surface B — low-level sidecar (advanced; no `/api/v1` prefix)

| Method & path | Query / body | Use |
| --- | --- | --- |
| `GET /health` | — | sidecar health: `canonical_url`, `query_root`, transport |
| `GET /sources` | — | sidecar source list |
| `GET /docs` | `?source=` | externally verifiable reference docs |
| `GET /manifest` | `?source=<id>` | a source's index/query files |
| `POST /search` | `{q,source,kind,match,limit}` | raw ranked search |
| `POST /search/batch` | `{q:[…],source,kind,match,limit}` | multi-term raw search |
| `GET /resolve` | `?source=<id>&file=<key>` | resolve a candidate key → real file |
| `GET /schema` | `?source=<id>&file=<key>&object=` | columns of a resolved file |
| `GET /extract` | `?source=&file=&columns=&limit=&offset=&sheet=&object=&format=json\|csv` | rows from ONE file |
| `GET /refresh`, `GET /admin` | — | **admin-gated; skip** |

Choose **A** for analysis-ready, stored, downloadable datasets. Choose **B** to confirm a specific physical file/columns before extracting, or for maintenance. Never mix the two extract shapes.

---

## 5. Variable query (`/api/v1/variables/query`)

Prefer **POST JSON** (handles Chinese/multilingual terms reliably):

```bash
curl -sS -X POST "$BASE/api/v1/variables/query" \
  -H 'Content-Type: application/json' \
  -d '{"query":"血压 blood pressure","source":"charls","limit":20}'
```

Fields:

| Field | Meaning |
| --- | --- |
| `query` | required; keywords, EN/ZH/mixed |
| `source` | one source id |
| `sources` | array of ids (batch); use with `perSourceLimit` |
| `limit` | total candidates cap |
| `perSourceLimit` | per-source cap when using `sources` |
| `kind` | index family hint (see below) |
| `match` | `all` (precise, default) or `any` (recall) |

Common `kind` values to try:

```text
auto, all, dictionary, variables, datasets, documents, concepts, joins, guardrails, overview
```

Survey sources → `dictionary, variables, datasets, documents`. ICU/EHR → `concepts, joins, guardrails`.

Batch:

```bash
curl -sS -X POST "$BASE/api/v1/variables/query" \
  -H 'Content-Type: application/json' \
  -d '{"query":"BMI body mass index 体重指数","sources":["nhanes","ukb","charls"],"perSourceLimit":10}'
```

Response: `{ok, query, sources, count, candidates:[{rank, source, …code/label fields…}], bySource}`. See §8 for which result fields are extractable codes vs. labels.

---

## 6. Extract / build dataset (`/api/v1/extract`)

Explicit variables:

```bash
curl -sS -X POST "$BASE/api/v1/extract" \
  -H 'Content-Type: application/json' \
  -d '{"source":"nhanes","selected":["BMXBMI"],"projectName":"nhanes_bmi_demo","rowCap":100}'
```

Query-to-dataset (API picks variables):

```bash
curl -sS -X POST "$BASE/api/v1/extract" \
  -H 'Content-Type: application/json' \
  -d '{"query":"BMI","source":"nhanes","variablesPerSource":1,"projectName":"nhanes_bmi_demo","rowCap":100}'
```

Request fields: `source` (or `sources`), `selected:[codes]` **or** `query`+`variablesPerSource`, `projectName`, `rowCap`, optional `filters` (`cohort`, `time_from`, `time_to`, `where`), `maxSources`, `continueOnError`.

Response (trimmed):

```json
{"ok":true,"status":"partial","datasets":[{
  "id":"20260614144026_nhanes_bmi_demo",
  "rows":5,"columns":2,"columnNames":["SDDSRVYR","BMXBMI"],
  "resolvedVariables":["SDDSRVYR","BMXBMI"],"unresolved":[],
  "fileMd5":"…","fileSize":50,
  "downloadUrl":"/api/v1/datasets/20260614144026_nhanes_bmi_demo/download",
  "detailUrl":"/api/v1/datasets/20260614144026_nhanes_bmi_demo",
  "preview":[{"SDDSRVYR":12,"BMXBMI":27}, …]}]}
```

Always read back `id`, `downloadUrl`, `columnNames`, `rows`, `unresolved`. Non-empty `unresolved` / `status:"partial"` → fix the offending codes and retry.

Download:

```bash
curl -L -o dataset.csv "$BASE/api/v1/datasets/<dataset_id>/download"
```

---

## 7. Python client

Dependency-free stdlib client, bundled at `skills/local-database-api-access/scripts/local_db_api.py`. Speaks **Surface B**; auto-detects the base (env → 8787 → 8878).

```bash
python3 <skill_dir>/scripts/local_db_api.py health
python3 <skill_dir>/scripts/local_db_api.py search --source charls --q "blood pressure" --limit 5
python3 <skill_dir>/scripts/local_db_api.py resolve --source nhanes --file <key>
python3 <skill_dir>/scripts/local_db_api.py schema  --source nhanes --file <file>
python3 <skill_dir>/scripts/local_db_api.py extract --source nhanes --file <file> --columns SEQN,BMXBMI --limit 20 --format csv -o out.csv
```

For stored, downloadable datasets use Surface A curl (§6).

---

## 8. Result field glossary (routing)

**Data-key / dataset fields** (resolve before claiming existence):
`extract_hint.file` (best), `parquet_rel`, `data_path`, `source_rel_path`, `dataset_path`, `file_path`, `path`, `source_file` (often raw), `data_paths` (may be `|`-separated). Reporting-only: `source_dataset_id`, `dataset_display_name`, `source_family`, `coverage_label`.

**Variable / column fields** (extractable codes):
`extract_hint.columns` (best), `physical_column`, `preferred_name`, `variable_name`, `source_variable_name`, `field_id` (UKB), `colname`, `column_name`, `raw_column_name`, `code`.

**Label-only fields** (NOT columns): `description_best`, `variable_label`, `label_text`, `label`, `title`, `description`, `notes`. Never extract a label as a column — confirm via `/schema` or `extract_hint`.

Identifier/design variables: UKB `eid`; NHANES `SEQN` (+ weights/strata/PSU); ICU/EHR `subject_id`,`hadm_id`,`stay_id`,`icustay_id`,`patientunitstayid` + timestamps; aging panels respondent/household ID + wave/year; Chinese surveys person/household/community ID + year/wave + module grain.

---

## 9. Start / Restart

Check first (`$BASE/api/v1/health`). Start only if nothing answers.

Local dev (from the app root with `server.js` + `database/`):

```bash
node server.js                  # → http://127.0.0.1:8787 (passwordless under trusted-local)
# or: bash database/start_deploy_api.sh
```

Production (Linux): Node on `127.0.0.1`, Python sidecar on a Unix socket; restart via the service manager so stale processes/sockets are dropped:

```bash
sudo systemctl restart medtimehelp-web.service
curl -sS "https://api.medtimehelp.com/api/v1/health"
```

Direct sidecar maintenance only (socket form):

```bash
export MEDHELP_DATABASE_DEPLOY_DIR="${MEDHELP_DATABASE_DEPLOY_DIR:-/opt/medtimehelp/database}"
nohup "$MEDHELP_DATABASE_DEPLOY_DIR/start_deploy_api.sh" \
  --socket /opt/medtimehelp/.runtime/database-api.sock \
  --allowed-origins http://localhost:8878,http://127.0.0.1:8878 \
  --idle-timeout-seconds 0 \
  > "$MEDHELP_DATABASE_DEPLOY_DIR/query/database_api/logs/server.out" 2>&1 &
```

The deploy directory must contain: `start_deploy_api.sh`, `query/database_api/server.py`, `query/database_api/index.duckdb`, `data/`. Point the skill elsewhere with `MEDHELP_DATABASE_DEPLOY_DIR`.

---

## 10. Reporting checklist

Every API-backed answer reports:

- source ID(s)
- endpoint + surface (A `/api/v1/*` vs B sidecar) and `kind`
- query terms used
- resolved file/data key
- extracted columns and row limit
- whether token auth was configured (without revealing it)
- warnings: cycle/wave/weight/join/time-window/table-grain/field-ID
