---
name: mineru-pdf-parser
description: Parse medical research PDFs in MedHelp Meta projects with MinerU into Markdown, tables, figures, page maps, and quality reports for evidence extraction.
allowed-tools:
  - Read
  - Write
  - Bash
---

# MinerU PDF Parser

## Purpose

Use this skill to convert legally obtained medical documents into structured, traceable artifacts for Meta projects.

Default to the MinerU precision API for project PDFs. Use the Agent light API only for small, tokenless jobs where the lighter limits are acceptable.

## API map

MinerU exposes two parsing systems:

1. Precision API: token required, supports single-file and batch parsing, and is the default path for Meta workflows.
2. Agent light API: no token required, IP-limited, and intended for quick AI-agent parsing.

## Precision API

### Single file

Create a parsing task with:

```python
import os
import requests

token = os.environ["MINERU_API_TOKEN"]
url = "https://mineru.net/api/v4/extract/task"
headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {token}",
}
data = {
    "url": "https://cdn-mineru.openxlab.org.cn/demo/example.pdf",
    "model_version": "vlm",
}

res = requests.post(url, headers=headers, json=data)
print(res.status_code)
print(res.json())
print(res.json()["data"])
```

Use `model_version` as:

- `pipeline` for the default precision model
- `vlm` for the recommended precision model
- `MinerU-HTML` for HTML sources

The response `data.task_id` is the handle for polling.

### Poll result

```python
import os
import requests

token = os.environ["MINERU_API_TOKEN"]
task_id = "task id from submit"
url = f"https://mineru.net/api/v4/extract/task/{task_id}"
headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {token}",
}

res = requests.get(url, headers=headers)
print(res.status_code)
print(res.json())
print(res.json()["data"])
```

Use `data.extract_result.full_zip_url` when the task is done. The zip package contains parsed outputs and may include Markdown, JSON, and export formats such as docx/html/latex.

### Script version

Use this minimal script when you want an executable end-to-end flow for submit, poll, download, and unzip:

```python
import io
import os
import time
import zipfile
from pathlib import Path

import requests

TOKEN = os.environ["MINERU_API_TOKEN"]
PDF_URL = "https://cdn-mineru.openxlab.org.cn/demo/example.pdf"
MODEL_VERSION = "vlm"
OUT_DIR = Path("mineru_out")
OUT_DIR.mkdir(parents=True, exist_ok=True)

headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {TOKEN}",
}

submit = requests.post(
    "https://mineru.net/api/v4/extract/task",
    headers=headers,
    json={"url": PDF_URL, "model_version": MODEL_VERSION},
)
submit.raise_for_status()
task_id = submit.json()["data"]["task_id"]

while True:
    poll = requests.get(
        f"https://mineru.net/api/v4/extract/task/{task_id}",
        headers=headers,
    )
    poll.raise_for_status()
    payload = poll.json()["data"]
    state = payload["extract_result"]["state"]
    if state == "done":
        zip_url = payload["extract_result"]["full_zip_url"]
        break
    if state == "failed":
        raise RuntimeError(payload["extract_result"].get("err_msg", "MinerU failed"))
    time.sleep(5)

zip_bytes = requests.get(zip_url, timeout=120).content
with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
    zf.extractall(OUT_DIR)
```

Minimal adjustments:

- Replace `PDF_URL` with the real PDF URL.
- Replace `MODEL_VERSION` if the project needs another precision model.
- Change `OUT_DIR` to the temporary folder you want for the unpacked result.

### Parse score

After unzip, assign a quick quality score:

```python
from pathlib import Path

def score_parse(out_dir: Path) -> str:
    text_files = list(out_dir.rglob("*.md")) + list(out_dir.rglob("*.txt"))
    table_files = list(out_dir.rglob("tables.json"))
    page_map_files = list(out_dir.rglob("page_map.json"))
    report_files = list(out_dir.rglob("parse_report.json"))

    if not text_files or not report_files:
        return "failed"

    text = max((p.read_text(encoding="utf-8", errors="ignore") for p in text_files), key=len, default="")
    has_title = len(text.splitlines()) > 2 and len(text.strip()) > 200
    has_abstract = "abstract" in text.lower() or "摘要" in text
    has_tables = bool(table_files)
    has_page_map = bool(page_map_files)
    garbled = text.count("�") > 20

    score = 0
    score += 1 if has_title else 0
    score += 1 if has_abstract else 0
    score += 1 if has_tables else 0
    score += 1 if has_page_map else 0
    score -= 2 if garbled else 0

    if score >= 3:
        return "good"
    if score >= 1:
        return "usable"
    return "poor"

print(score_parse(OUT_DIR))
```

Use this as a quick first pass. If the score is `poor` or `failed`, send it to manual review; if it is `usable`, pass it onward for evidence extraction.

### Batch URL submit

```python
import os
import requests

token = os.environ["MINERU_API_TOKEN"]
url = "https://mineru.net/api/v4/extract/task/batch"
headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {token}",
}
data = {
    "files": [
        {"url": "https://cdn-mineru.openxlab.org.cn/demo/example.pdf", "data_id": "abcd"}
    ],
    "model_version": "vlm",
}

res = requests.post(url, headers=headers, json=data)
print(res.status_code)
print(res.json())
print(res.json()["data"])
```

Poll batch results with:

```python
import os
import requests

token = os.environ["MINERU_API_TOKEN"]
batch_id = "batch id from submit"
url = f"https://mineru.net/api/v4/extract-results/batch/{batch_id}"
headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {token}",
}

res = requests.get(url, headers=headers)
print(res.status_code)
print(res.json())
print(res.json()["data"])
```

### Batch local file upload

Use this when the file is local and you want MinerU to return signed upload URLs:

1. Call `POST https://mineru.net/api/v4/file-urls/batch`.
2. Upload each file with `PUT` to the returned `file_url`.
3. MinerU auto-submits the parse task after upload completes.

This endpoint is for file upload link generation, not direct parse submission.

## Agent light API

### URL parse

```python
import requests

url = "https://mineru.net/api/v1/agent/parse/url"
data = {
    "url": "https://cdn-mineru.openxlab.org.cn/demo/example.pdf",
    "language": "ch",
    "enable_table": True,
    "is_ocr": False,
    "enable_formula": True,
}

res = requests.post(url, json=data)
print(res.json())
```

This endpoint returns a `task_id` for polling. It does not require an Authorization header.

### Local file upload

```python
import requests

url = "https://mineru.net/api/v1/agent/parse/file"
data = {
    "file_name": "example.pdf",
    "language": "ch",
    "enable_table": True,
    "is_ocr": False,
    "enable_formula": True,
}

res = requests.post(url, json=data)
print(res.json())
```

Then upload the file to the returned signed `file_url` with `PUT`, and poll `GET https://mineru.net/api/v1/agent/parse/{task_id}`.

## Operational limits

- Precision API file size limit: 200 MB.
- Precision API page limit: 200 pages.
- Precision submit and batch submit share a 300 requests/minute limit.
- Precision result polling and batch result polling share a 1,000 requests/minute limit.
- Batch upload-link requests are capped per request; keep them small and follow the endpoint limit.
- Agent light API file size limit: 10 MB.
- Agent light API page limit: 20 pages.
- Agent light API is IP-limited and returns HTTP 429 when throttled.

## Project output

Write parsed outputs to:

```text
04_full_text_review/fulltext/{reference_id}/mineru/
  {paper-title}.md
  tables.json
  figures/
  page_map.json
  parse_report.json
```

## Required behavior

- Read the precision API token from `MINERU_API_TOKEN`. In MedHelp, ask the user to save it under Settings → Integrations → MinerU when the variable is unavailable; never ask them to paste it into a prompt or source file.
- Keep original page references.
- Preserve table labels where possible.
- Save figures separately.
- Save parse reports.
- Do not claim parse success unless output files exist.
- Mark poor parsing for human review.
- Keep `reference_id`, source PDF path, parser version/provider, timestamps, and errors in the parse manifest.
- Never expose MinerU tokens in files or responses.

## Quality score

Score each parse as:

- `good`
- `usable`
- `poor`
- `failed`

Use `references/mineru-parse-quality-rubric.md` to judge quality. Send usable parses to `pdf-evidence-extraction`; send poor or failed parses to manual review.
