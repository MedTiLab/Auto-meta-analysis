#!/usr/bin/env python3
"""
Search recent Europe PMC records for configured biomedical domains and score
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
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional, Tuple

from scoring_utils import (
    SCORE_MAX,
    calculate_quality_score,
    calculate_recommendation_score,
    calculate_recency_score,
    calculate_relevance_score,
)
from ssl_utils import create_ssl_context

logger = logging.getLogger(__name__)

EUROPE_PMC_BASE_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
REQUEST_HEADERS = {
    "User-Agent": "meddata-claw/1.1 (research-feed)",
    "Accept": "application/json, */*;q=0.8",
}
REQUEST_PAUSE_SECONDS = 0.34
REQUEST_RETRY_ATTEMPTS = 4
SSL_CONTEXT, SSL_CA_FILE = create_ssl_context()

HIGH_IMPACT_JOURNALS = {
    "new england journal of medicine": 1.8,
    "nejm": 1.8,
    "the lancet": 1.7,
    "jama": 1.5,
    "bmj": 1.4,
    "nature medicine": 1.6,
    "nature biotechnology": 1.5,
    "nature genetics": 1.5,
    "nature": 1.3,
    "cell": 1.3,
    "science": 1.3,
}


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


def request_json(params: Dict[str, str], timeout: int = 30, attempts: int = REQUEST_RETRY_ATTEMPTS) -> Dict:
    url = f"{EUROPE_PMC_BASE_URL}?{urllib.parse.urlencode(params)}"
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
                    "Europe PMC request failed (attempt %d/%d): %s; retrying in %.1fs",
                    attempt,
                    attempts,
                    err,
                    wait_seconds,
                )
                time.sleep(wait_seconds)

    raise RuntimeError(f"Failed to fetch Europe PMC data after {attempts} attempts: {last_error}") from last_error


def compact_whitespace(value: str) -> str:
    return " ".join(value.split())


def parse_date_like(value: str) -> Tuple[str, Optional[datetime]]:
    raw = (value or "").strip()
    if not raw:
        return "", None

    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m", "%Y"):
        try:
            parsed = datetime.strptime(raw, fmt)
            if fmt == "%Y-%m":
                parsed = parsed.replace(day=1)
            elif fmt == "%Y":
                parsed = parsed.replace(month=1, day=1)
            return parsed.strftime("%Y-%m-%d"), parsed
        except ValueError:
            continue

    return raw, None


def build_keyword_query(keywords: List[str]) -> Optional[str]:
    terms = []
    for keyword in keywords:
        normalized = keyword.strip().replace('"', "")
        if normalized:
            terms.append(f'"{normalized}"')
    if not terms:
        return None
    return "(" + " OR ".join(terms) + ")"


def parse_authors(item: Dict) -> Tuple[List[str], str]:
    author_nodes = item.get("authorList", {}).get("author", [])
    if isinstance(author_nodes, dict):
        author_nodes = [author_nodes]

    authors: List[str] = []
    for author in author_nodes:
        if isinstance(author, dict):
            full_name = compact_whitespace(author.get("fullName", ""))
        else:
            full_name = compact_whitespace(str(author))
        if full_name:
            authors.append(full_name)

    if len(authors) <= 6:
        authors_str = ", ".join(authors)
    else:
        authors_str = ", ".join(authors[:6]) + ", et al."

    return authors, authors_str


def build_article_link(record: Dict) -> str:
    pmid = record.get("pmid")
    pmcid = record.get("pmcid")
    doi = record.get("doi")
    if pmid:
        return f"https://europepmc.org/article/MED/{pmid}"
    if pmcid:
        return f"https://europepmc.org/article/PMC/{pmcid}"
    if doi:
        return f"https://europepmc.org/article/DOI/{urllib.parse.quote(doi, safe='')}"
    title = urllib.parse.quote(record.get("title", ""))
    return f"https://europepmc.org/search?query={title}"


def parse_record(item: Dict, days_back: int) -> Optional[Dict]:
    title = compact_whitespace(item.get("title", ""))
    abstract = compact_whitespace(item.get("abstractText", ""))
    if not title or not abstract:
        return None

    journal_info = item.get("journalInfo", {}) or {}
    journal_data = journal_info.get("journal", {}) or {}
    journal = compact_whitespace(journal_data.get("title", "") or item.get("journalTitle", ""))
    published, published_date = parse_date_like(
        item.get("firstPublicationDate", "")
        or item.get("electronicPublicationDate", "")
        or journal_info.get("printPublicationDate", "")
    )
    if published_date:
        age = datetime.utcnow() - published_date
        if age.days > days_back:
            return None

    authors, authors_str = parse_authors(item)

    keyword_nodes = item.get("keywordList", {}).get("keyword", [])
    if isinstance(keyword_nodes, str):
        keywords = [keyword_nodes]
    else:
        keywords = [compact_whitespace(str(keyword)) for keyword in keyword_nodes if str(keyword).strip()]

    pub_type_nodes = item.get("pubTypeList", {}).get("pubType", [])
    if isinstance(pub_type_nodes, str):
        publication_types = [pub_type_nodes]
    else:
        publication_types = [compact_whitespace(str(pub_type)) for pub_type in pub_type_nodes if str(pub_type).strip()]

    pmid = item.get("pmid", "").strip()
    pmcid = item.get("pmcid", "").strip()
    doi = item.get("doi", "").strip()
    article_id = pmid or pmcid or doi or f"europepmc-{abs(hash(title))}"

    return {
        "id": article_id,
        "pmid": pmid,
        "pmcid": pmcid,
        "doi": doi,
        "title": title,
        "abstract": abstract[:4000],
        "authors": authors,
        "authors_str": authors_str,
        "published": published,
        "published_date": published_date,
        "journal": journal,
        "keywords": keywords,
        "publication_types": publication_types,
    }


def search_domain_records(domain_name: str, keywords: List[str], limit: int, days_back: int) -> List[Dict]:
    keyword_query = build_keyword_query(keywords)
    if not keyword_query:
        logger.warning("Skipping domain '%s' because it has no keywords.", domain_name)
        return []

    records: List[Dict] = []
    cursor_mark = "*"
    min_date = (datetime.utcnow() - timedelta(days=days_back)).strftime("%Y-%m-%d")

    logger.info("Europe PMC search for '%s' (%d keywords, limit=%d)", domain_name, len(keywords), limit)
    while len(records) < limit:
        page_size = min(100, limit - len(records))
        payload = request_json(
            {
                "query": f"{keyword_query} AND HAS_ABSTRACT:y AND FIRST_PDATE:[{min_date} TO *]",
                "resultType": "core",
                "pageSize": str(page_size),
                "format": "json",
                "cursorMark": cursor_mark,
                "sort": "P_PDATE_D desc",
            }
        )

        result_list = payload.get("resultList", {}).get("result", [])
        if not result_list:
            break

        for item in result_list:
            record = parse_record(item, days_back)
            if record:
                records.append(record)

        next_cursor = payload.get("nextCursorMark")
        if not next_cursor or next_cursor == cursor_mark:
            break
        cursor_mark = next_cursor

    logger.info("  %s: %d Europe PMC records", domain_name, len(records))
    return records[:limit]


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


def collect_records(config: Dict, max_results: int, date_range_days: int) -> List[Dict]:
    domains = get_domains(config)
    ordered_domains = sorted(
        domains.items(),
        key=lambda item: item[1].get("priority", 0),
        reverse=True,
    )
    per_domain_limit = max(20, math.ceil(max_results / max(len(ordered_domains), 1)))

    seen_ids = set()
    ordered_records: List[Dict] = []
    for domain_name, domain_config in ordered_domains:
        domain_records = search_domain_records(
            domain_name,
            domain_config.get("keywords", []),
            per_domain_limit,
            date_range_days,
        )
        for record in domain_records:
            if record["id"] not in seen_ids:
                seen_ids.add(record["id"])
                ordered_records.append(record)

    return ordered_records[:max_results]


def calculate_popularity_score(record: Dict) -> float:
    score = 0.2 if record.get("abstract") else 0.0
    journal_name = record.get("journal", "").lower()

    for journal_key, journal_score in HIGH_IMPACT_JOURNALS.items():
        if journal_key in journal_name:
            score = max(score, journal_score)
            break

    publication_types = {entry.lower() for entry in record.get("publication_types", [])}
    if {"meta-analysis", "systematic review"} & publication_types:
        score += 1.0
    elif {"practice guideline", "guideline"} & publication_types:
        score += 0.9
    elif {"randomized controlled trial", "clinical trial"} & publication_types:
        score += 0.7
    elif "review" in publication_types:
        score += 0.35

    if record.get("doi"):
        score += 0.1

    return min(score, SCORE_MAX)


def score_records(records: List[Dict], config: Dict) -> Tuple[List[Dict], int]:
    domains = get_domains(config)
    excluded_keywords = config.get("excluded_keywords", [])

    scored_records: List[Dict] = []
    total_filtered = 0

    for record in records:
        relevance, matched_domain, matched_keywords = calculate_relevance_score(
            {
                "title": record.get("title", ""),
                "abstract": record.get("abstract", ""),
                "categories": record.get("publication_types", []) + record.get("keywords", []),
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

        categories = record.get("publication_types", [])[:2]
        categories.extend([kw for kw in record.get("keywords", [])[:2] if kw not in categories])
        if not categories and record.get("journal"):
            categories = [record["journal"]]

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
                "link": build_article_link(record),
                "source": "europepmc",
            }
        )

    scored_records.sort(key=lambda item: item["final_score"], reverse=True)
    return scored_records, total_filtered


def main() -> int:
    parser = argparse.ArgumentParser(description="Search and rank Europe PMC papers")
    parser.add_argument("--config", type=str, required=True, help="Path to research config JSON/YAML")
    parser.add_argument("--output", type=str, default="europepmc_results.json", help="Output JSON file path")
    parser.add_argument("--top-n", type=int, default=10, help="Number of papers to return")
    parser.add_argument("--max-results", type=int, default=120, help="Maximum Europe PMC records to fetch")
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

    records = collect_records(config, args.max_results, args.date_range_days)
    logger.info("Collected %d unique Europe PMC records", len(records))

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
