#!/usr/bin/env python3
"""
Download legally available public literature PDFs from PMC OA resources.

This script is intentionally conservative:
- It only uses official NCBI/PMC endpoints.
- It does not scrape publisher pages.
- It records unavailable items instead of bypassing access controls.

Input can be CSV or JSON. Supported identifier fields include PMID, PMCID, DOI,
and lowercase variants.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

IDCONV_URL = "https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/"
PMC_OA_URL = "https://www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi"
DEFAULT_USER_AGENT = "MedAutoDataMetaAnalysis/1.0"

Record = Dict[str, Any]
ManifestRecord = Dict[str, Any]


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def compact(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def pick(record: Record, *keys: str) -> str:
    for key in keys:
        if key in record and compact(record[key]):
            return compact(record[key])
    lowered = {str(k).lower(): v for k, v in record.items()}
    for key in keys:
        value = lowered.get(key.lower())
        if compact(value):
            return compact(value)
    return ""


def normalize_pmcid(value: str) -> str:
    value = compact(value)
    if not value:
        return ""
    value = value.upper().replace(" ", "")
    if value.isdigit():
        return f"PMC{value}"
    if value.startswith("PMC"):
        return value
    return value


def normalize_pmid(value: str) -> str:
    value = compact(value)
    match = re.search(r"\d+", value)
    return match.group(0) if match else ""


def normalize_doi(value: str) -> str:
    value = compact(value)
    value = re.sub(r"^https?://(dx\.)?doi\.org/", "", value, flags=re.I)
    value = re.sub(r"^doi:\s*", "", value, flags=re.I)
    return value.strip()


def safe_filename(value: str, max_len: int = 96) -> str:
    value = compact(value) or "untitled"
    value = re.sub(r"[\\/:*?\"<>|]+", "-", value)
    value = re.sub(r"[^A-Za-z0-9._\-\u4e00-\u9fff ]+", "", value)
    value = re.sub(r"\s+", "_", value).strip("._-")
    return (value[:max_len] or "untitled")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_input(path: Path) -> List[Record]:
    suffix = path.suffix.lower()
    if suffix == ".json":
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            for key in ("references", "records", "items"):
                if isinstance(payload.get(key), list):
                    return [dict(item) for item in payload[key]]
            raise ValueError("JSON object must contain a list under references, records, or items")
        if isinstance(payload, list):
            return [dict(item) for item in payload]
        raise ValueError("JSON input must be a list or an object containing a list")

    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return [dict(row) for row in reader]


def write_summary_csv(path: Path, rows: Sequence[ManifestRecord]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "input_index", "reference_id", "pmid", "pmcid", "doi", "title", "status", "source",
        "url", "path", "reason", "checked_at", "sha256",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def chunked(values: Sequence[str], size: int) -> Iterable[Sequence[str]]:
    for start in range(0, len(values), size):
        yield values[start:start + size]


def http_get(url: str, *, user_agent: str, timeout: int = 30) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": user_agent})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def build_idconv_url(ids: Sequence[str], tool: str, email: str) -> str:
    params = {
        "ids": ",".join(ids),
        "format": "json",
        "tool": tool,
    }
    if email:
        params["email"] = email
    return f"{IDCONV_URL}?{urllib.parse.urlencode(params)}"


def idconv_lookup(ids: Sequence[str], *, tool: str, email: str, delay: float, user_agent: str) -> Dict[str, Record]:
    resolved: Dict[str, Record] = {}
    for part in chunked(list(ids), 200):
        url = build_idconv_url(part, tool, email)
        data = json.loads(http_get(url, user_agent=user_agent).decode("utf-8"))
        for rec in data.get("records", []):
            for key in ("pmid", "pmcid", "doi"):
                value = compact(rec.get(key))
                if value:
                    resolved[value.lower()] = rec
                    resolved[value.upper()] = rec
        time.sleep(delay)
    return resolved


def build_oa_url(pmcid: str) -> str:
    params = {
        "id": pmcid,
        "format": "pdf",
    }
    return f"{PMC_OA_URL}?{urllib.parse.urlencode(params)}"


def convert_ftp_to_https(url: str) -> str:
    if url.startswith("ftp://ftp.ncbi.nlm.nih.gov/"):
        return "https://ftp.ncbi.nlm.nih.gov/" + url[len("ftp://ftp.ncbi.nlm.nih.gov/"):]
    return url


def parse_pmc_oa_links(xml_bytes: bytes) -> Tuple[List[Tuple[str, str]], Optional[str]]:
    """Return [(format, url)], error_message."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as error:
        return [], f"Invalid XML from PMC OA service: {error}"

    error_node = root.find(".//error")
    if error_node is not None:
        return [], compact(error_node.text) or "PMC OA service returned an error"

    links: List[Tuple[str, str]] = []
    for link in root.findall(".//link"):
        href = compact(link.attrib.get("href"))
        fmt = compact(link.attrib.get("format")).lower()
        if href:
            links.append((fmt, convert_ftp_to_https(href)))

    return links, None


def choose_download_link(links: Sequence[Tuple[str, str]], allow_tgz: bool) -> Tuple[Optional[str], Optional[str]]:
    for fmt, url in links:
        if fmt == "pdf" or url.lower().endswith(".pdf"):
            return "pmc_oa", url
    if allow_tgz:
        for fmt, url in links:
            if fmt in {"tgz", "tar.gz"} or url.lower().endswith((".tgz", ".tar.gz")):
                return "pmc_tgz", url
    return None, None


def infer_extension(url: str, source: str) -> str:
    lowered = url.lower().split("?", 1)[0]
    if lowered.endswith(".pdf") or source == "pmc_oa":
        return ".pdf"
    if lowered.endswith(".tar.gz"):
        return ".tar.gz"
    if lowered.endswith(".tgz") or source == "pmc_tgz":
        return ".tgz"
    return ".dat"


def download_file(url: str, path: Path, *, user_agent: str, overwrite: bool) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not overwrite:
        return "exists"
    data = http_get(url, user_agent=user_agent, timeout=120)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)
    return "downloaded"


def create_base_manifest(index: int, record: Record) -> ManifestRecord:
    return {
        "input_index": index,
        "reference_id": pick(record, "reference_id", "record_id", "id", "study_id") or None,
        "pmid": normalize_pmid(pick(record, "pmid", "PMID")) or None,
        "pmcid": normalize_pmcid(pick(record, "pmcid", "PMCID")) or None,
        "doi": normalize_doi(pick(record, "doi", "DOI")) or None,
        "title": pick(record, "title", "Title", "article_title") or None,
        "status": "failed",
        "source": None,
        "url": None,
        "path": None,
        "reason": None,
        "checked_at": now_iso(),
        "sha256": None,
    }


def resolve_identifiers(rows: List[ManifestRecord], *, tool: str, email: str, delay: float, user_agent: str) -> None:
    ids: List[str] = []
    for row in rows:
        if row.get("pmcid"):
            continue
        for key in ("pmid", "doi"):
            value = compact(row.get(key))
            if value:
                ids.append(value)
                break
    if not ids:
        return

    lookup = idconv_lookup(ids, tool=tool, email=email, delay=delay, user_agent=user_agent)
    for row in rows:
        if row.get("pmcid"):
            continue
        candidates = [compact(row.get("pmid")), compact(row.get("doi"))]
        found = None
        for candidate in candidates:
            if candidate and (candidate.lower() in lookup or candidate.upper() in lookup):
                found = lookup.get(candidate.lower()) or lookup.get(candidate.upper())
                break
        if found:
            row["pmid"] = row.get("pmid") or compact(found.get("pmid")) or None
            row["pmcid"] = normalize_pmcid(compact(found.get("pmcid"))) or None
            row["doi"] = row.get("doi") or normalize_doi(compact(found.get("doi"))) or None


def process_rows(
    rows: List[ManifestRecord],
    *,
    output_dir: Path,
    tool: str,
    email: str,
    delay: float,
    user_agent: str,
    dry_run: bool,
    allow_tgz: bool,
    overwrite: bool,
    reference_dir_layout: bool,
) -> List[ManifestRecord]:
    output_dir.mkdir(parents=True, exist_ok=True)
    resolve_identifiers(rows, tool=tool, email=email, delay=delay, user_agent=user_agent)

    for row in rows:
        row["checked_at"] = now_iso()
        pmcid = compact(row.get("pmcid"))
        if not compact(row.get("pmid")) and not compact(row.get("doi")) and not pmcid:
            row.update(status="no_identifier", reason="No PMID, DOI, or PMCID was provided")
            continue
        if not pmcid:
            row.update(status="no_pmcid", reason="Could not map identifier to a PMCID")
            continue

        try:
            oa_xml = http_get(build_oa_url(pmcid), user_agent=user_agent)
            links, error = parse_pmc_oa_links(oa_xml)
            if error:
                row.update(status="not_oa", reason=error)
                time.sleep(delay)
                continue

            source, url = choose_download_link(links, allow_tgz=allow_tgz)
            if not url or not source:
                row.update(status="no_oa_pdf", reason="PMC OA record found, but no PDF link was available")
                time.sleep(delay)
                continue

            extension = infer_extension(url, source)
            title_part = safe_filename(compact(row.get("title")) or pmcid)
            if reference_dir_layout:
                reference_part = safe_filename(
                    compact(row.get("reference_id"))
                    or pmcid
                    or compact(row.get("pmid"))
                    or compact(row.get("doi"))
                    or title_part,
                )
                target = output_dir / reference_part / f"{title_part}{extension}"
            else:
                file_name = f"{safe_filename(pmcid)}_{title_part}{extension}"
                target = output_dir / file_name

            row.update(source=source, url=url, path=str(target))
            if dry_run:
                row.update(status="dry_run", reason="Dry run; file not downloaded")
            else:
                status = download_file(url, target, user_agent=user_agent, overwrite=overwrite)
                row.update(status=status, reason=None, sha256=sha256_file(target))
        except Exception as error:  # noqa: BLE001 - manifest should retain exact failure reason
            row.update(status="failed", reason=str(error))
        finally:
            time.sleep(delay)

    return rows


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Download legal public OA PDFs using official PMC endpoints.")
    parser.add_argument("--input", required=True, help="CSV or JSON references file")
    parser.add_argument("--output-dir", required=True, help="Directory for downloaded PDFs")
    parser.add_argument("--manifest", required=True, help="JSON manifest output path")
    parser.add_argument("--summary-csv", default=None, help="Optional CSV manifest output path")
    parser.add_argument("--tool", default="medautodata_meta", help="Tool name sent to NCBI services")
    parser.add_argument("--email", default="", help="Email sent to NCBI services")
    parser.add_argument("--delay", type=float, default=0.34, help="Delay between NCBI/PMC requests in seconds")
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT, help="HTTP User-Agent")
    parser.add_argument("--dry-run", action="store_true", help="Resolve links without downloading files")
    parser.add_argument("--allow-tgz", action="store_true", help="Download PMC OA .tgz archives when PDF is unavailable")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing files")
    parser.add_argument("--reference-dir-layout", action="store_true", help="Write each file under output-dir/<reference-id-or-pmcid>/<title>.*")
    parser.add_argument("--max", type=int, default=None, help="Limit number of input records")
    args = parser.parse_args(argv)

    input_path = Path(args.input)
    output_dir = Path(args.output_dir)
    manifest_path = Path(args.manifest)
    summary_csv_path = Path(args.summary_csv) if args.summary_csv else None

    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 2

    records = read_input(input_path)
    if args.max is not None:
        records = records[: max(args.max, 0)]

    rows = [create_base_manifest(index, record) for index, record in enumerate(records)]
    rows = process_rows(
        rows,
        output_dir=output_dir,
        tool=args.tool,
        email=args.email,
        delay=max(args.delay, 0),
        user_agent=args.user_agent,
        dry_run=args.dry_run,
        allow_tgz=args.allow_tgz,
        overwrite=args.overwrite,
        reference_dir_layout=args.reference_dir_layout,
    )

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    if summary_csv_path:
        write_summary_csv(summary_csv_path, rows)

    counts: Dict[str, int] = {}
    for row in rows:
        status = str(row.get("status") or "unknown")
        counts[status] = counts.get(status, 0) + 1
    print(json.dumps({"total": len(rows), "counts": counts, "manifest": str(manifest_path)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
