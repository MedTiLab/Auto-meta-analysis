#!/usr/bin/env python3
"""
Search recent medRxiv preprints for configured biomedical domains and score
them for the MedHelp® research feed.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import socket
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

from scoring_utils import (
    SCORE_MAX,
    calculate_quality_score,
    calculate_recommendation_score,
    calculate_recency_score,
    calculate_relevance_score,
)
from ssl_utils import create_ssl_context

logger = logging.getLogger(__name__)

REQUEST_HEADERS = {
    "User-Agent": "meddata-claw/1.1 (research-feed)",
    "Accept": "application/json, */*;q=0.8",
}
REQUEST_PAUSE_SECONDS = 0.5
REQUEST_RETRY_ATTEMPTS = 4
BATCH_SIZE = 100
SSL_CONTEXT, SSL_CA_FILE = create_ssl_context()


def load_research_config(config_path: str) -> Dict:
    with open(config_path, "r", encoding="utf-8") as handle:
        if config_path.endswith(".json"):
            return json.load(handle)

        try:
            import yaml  # type: ignore

            return yaml.safe_load(handle)
        except ImportError:
            handle.seek(0)
            return json.load(handle)


def request_json(url: str, timeout: int = 30, attempts: int = REQUEST_RETRY_ATTEMPTS) -> Dict:
    last_error: Optional[Exception] = None

    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(url, headers=REQUEST_HEADERS)
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=SSL_CONTEXT) as response:
                payload = response.read().decode("utf-8")
            time.sleep(REQUEST_PAUSE_SECONDS)
            return json.loads(payload)
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionResetError, json.JSONDecodeError) as err:
            last_error = err
            if attempt < attempts:
                wait_seconds = min(8.0, 0.8 * (2 ** (attempt - 1)))
                logger.warning(
                    "medRxiv request failed (attempt %d/%d): %s; retrying in %.1fs",
                    attempt,
                    attempts,
                    err,
                    wait_seconds,
                )
                time.sleep(wait_seconds)

    raise RuntimeError(f"Failed to fetch medRxiv data after {attempts} attempts: {last_error}") from last_error


def compact_whitespace(value: str) -> str:
    return " ".join(value.split())


def parse_date(value: str) -> Tuple[str, Optional[datetime]]:
    raw = (value or "").strip()
    if not raw:
        return "", None
    try:
        parsed = datetime.strptime(raw, "%Y-%m-%d")
        return parsed.strftime("%Y-%m-%d"), parsed
    except ValueError:
        return raw, None


def get_domains(config: Dict) -> Dict:
    domains = config.get("research_domains", {})
    if domains:
        return domains
    return {
        "Biomedical Research": {
            "keywords": ["clinical", "disease", "therapy", "biomarker"],
            "priority": 1,
        }
    }


def build_preprint_link(doi: str, version: str) -> str:
    suffix = f"{doi}v{version}" if version else doi
    return f"https://www.medrxiv.org/content/{suffix}"


def parse_record(item: Dict) -> Optional[Dict]:
    doi = compact_whitespace(item.get("doi", ""))
    title = compact_whitespace(item.get("title", ""))
    abstract = compact_whitespace(item.get("abstract", ""))
    if not title or not abstract:
        return None

    published, published_date = parse_date(item.get("date", ""))
    version = compact_whitespace(str(item.get("version", "1")))
    category = compact_whitespace(item.get("category", ""))
    authors_str = compact_whitespace(item.get("authors", ""))

    return {
        "id": f"medrxiv-{doi}" if doi else f"medrxiv-{abs(hash(title))}",
        "title": title,
        "abstract": abstract[:4000],
        "authors_str": authors_str,
        "published": published,
        "published_date": published_date,
        "category": category,
        "doi": doi,
        "version": version,
        "link": build_preprint_link(doi, version) if doi else "https://www.medrxiv.org/",
    }


def fetch_recent_preprints(max_results: int, days_back: int) -> List[Dict]:
    date_to = datetime.utcnow().date()
    date_from = date_to - timedelta(days=days_back)

    date_from_str = date_from.strftime("%Y-%m-%d")
    date_to_str = date_to.strftime("%Y-%m-%d")

    records: List[Dict] = []
    cursor = 0

    logger.info("medRxiv search (%s to %s, limit=%d)", date_from_str, date_to_str, max_results)
    while len(records) < max_results:
        url = f"https://api.medrxiv.org/details/medrxiv/{date_from_str}/{date_to_str}/{cursor}/json"
        payload = request_json(url)
        collection = payload.get("collection", [])
        if not collection:
            break

        for item in collection:
            record = parse_record(item)
            if record:
                records.append(record)
                if len(records) >= max_results:
                    break

        total = int(payload.get("messages", [{}])[0].get("total", 0) or 0)
        cursor += BATCH_SIZE
        if cursor >= total:
            break

    logger.info("Collected %d medRxiv preprints", len(records))
    return records[:max_results]


def calculate_popularity_score(record: Dict) -> float:
    score = 0.15

    if record.get("doi"):
        score += 0.15
    if record.get("version") and str(record["version"]).isdigit() and int(record["version"]) > 1:
        score += 0.2

    category = record.get("category", "").lower()
    if any(token in category for token in ("clinical trial", "epidemiology", "oncology")):
        score += 0.25

    if len(record.get("abstract", "")) >= 1600:
        score += 0.1

    return min(score, SCORE_MAX)


def score_records(records: List[Dict], config: Dict) -> Tuple[List[Dict], int]:
    domains = get_domains(config)
    excluded_keywords = config.get("excluded_keywords", [])

    scored_records: List[Dict] = []
    total_filtered = 0

    for record in records:
        categories = [record["category"], "Preprint"] if record.get("category") else ["Preprint"]
        relevance, matched_domain, matched_keywords = calculate_relevance_score(
            {
                "title": record.get("title", ""),
                "abstract": record.get("abstract", ""),
                "categories": categories,
            },
            domains,
            excluded_keywords,
        )

        if relevance == 0:
            total_filtered += 1
            continue

        recency = calculate_recency_score(record.get("published_date"))
        popularity = calculate_popularity_score(record)
        quality = calculate_quality_score(record.get("abstract", ""))
        final_score = calculate_recommendation_score(relevance, recency, popularity, quality)

        scored_records.append(
            {
                "id": record["id"],
                "title": record["title"],
                "authors": record["authors_str"],
                "abstract": record["abstract"],
                "published": record["published"],
                "categories": categories[:3],
                "relevance_score": round(relevance, 2),
                "recency_score": round(recency, 2),
                "popularity_score": round(popularity, 2),
                "quality_score": round(quality, 2),
                "final_score": final_score,
                "matched_domain": matched_domain,
                "matched_keywords": matched_keywords,
                "link": record["link"],
                "pdf_link": f"{record['link']}.full.pdf" if record.get("doi") else None,
                "source": "medrxiv",
            }
        )

    scored_records.sort(key=lambda item: item["final_score"], reverse=True)
    return scored_records, total_filtered


def main() -> int:
    parser = argparse.ArgumentParser(description="Search and rank medRxiv preprints")
    parser.add_argument("--config", type=str, required=True, help="Path to research config JSON/YAML")
    parser.add_argument("--output", type=str, default="medrxiv_results.json", help="Output JSON file path")
    parser.add_argument("--top-n", type=int, default=10, help="Number of papers to return")
    parser.add_argument("--max-results", type=int, default=150, help="Maximum medRxiv records to fetch")
    parser.add_argument("--date-range-days", type=int, default=30, help="How many recent days to search")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )

    if SSL_CA_FILE:
        logger.info("Using CA bundle: %s", SSL_CA_FILE)

    logger.info("Loading config from: %s", args.config)
    config = load_research_config(args.config)

    records = fetch_recent_preprints(args.max_results, args.date_range_days)
    scored_records, total_filtered = score_records(records, config)
    top_papers = scored_records[: args.top_n]

    output = {
        "top_papers": top_papers,
        "total_found": len(records),
        "total_filtered": total_filtered,
        "search_date": datetime.utcnow().strftime("%Y-%m-%d"),
    }

    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(output, handle, ensure_ascii=False, indent=2, default=str)

    logger.info("Results saved to: %s", args.output)
    logger.info("Top %d papers:", len(top_papers))
    for index, paper in enumerate(top_papers, start=1):
        logger.info("%d. %s... (Score: %s)", index, paper["title"][:60], paper["final_score"])

    print(json.dumps(output, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
