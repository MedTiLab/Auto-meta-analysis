#!/usr/bin/env python3
"""
Search recent PubMed records for configured biomedical domains and score them
for the MedAutoData research feed.
"""

from __future__ import annotations

import argparse
import http.client
import json
import logging
import math
import socket
import sys
import time
import urllib.parse
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional, Tuple, Union

from scoring_utils import (
    SCORE_MAX,
    calculate_quality_score,
    calculate_recommendation_score,
    calculate_recency_score,
    calculate_relevance_score,
)
from ssl_utils import create_ssl_context

logger = logging.getLogger(__name__)

EUTILS_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
REQUEST_HEADERS = {
    "User-Agent": "medautodata/1.1 (research-feed)",
    "Accept": "application/json, text/xml;q=0.9, */*;q=0.8",
    "Accept-Encoding": "identity",
    "Connection": "close",
}
REQUEST_PAUSE_SECONDS = 0.34
REQUEST_RETRY_ATTEMPTS = 4
FETCH_BATCH_SIZE = 20
MIN_FETCH_BATCH_SIZE = 5
SSL_CONTEXT, SSL_CA_FILE = create_ssl_context()

MONTH_MAP = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}

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


def request_url(endpoint: str, params: Dict[str, str], timeout: int = 30, attempts: int = REQUEST_RETRY_ATTEMPTS) -> bytes:
    url = f"{EUTILS_BASE_URL}/{endpoint}?{urllib.parse.urlencode(params)}"
    last_error: Optional[Exception] = None

    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(url, headers=REQUEST_HEADERS)
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=SSL_CONTEXT) as response:
                payload = response.read()
            time.sleep(REQUEST_PAUSE_SECONDS)
            return payload
        except (urllib.error.URLError, http.client.HTTPException, socket.timeout, TimeoutError, ConnectionResetError) as err:
            last_error = err
        except http.client.IncompleteRead as err:
            last_error = err

        if attempt < attempts:
            wait_seconds = min(8.0, 0.8 * (2 ** (attempt - 1)))
            logger.warning(
                "Request to %s failed (attempt %d/%d): %s; retrying in %.1fs",
                endpoint,
                attempt,
                attempts,
                last_error,
                wait_seconds,
            )
            time.sleep(wait_seconds)

    raise RuntimeError(f"Failed to fetch {endpoint} after {attempts} attempts: {last_error}") from last_error


def request_json(endpoint: str, params: Dict[str, str], timeout: int = 30, attempts: int = REQUEST_RETRY_ATTEMPTS) -> Dict:
    return json.loads(request_url(endpoint, params, timeout=timeout, attempts=attempts).decode("utf-8"))


def request_xml(endpoint: str, params: Dict[str, str], timeout: int = 30, attempts: int = REQUEST_RETRY_ATTEMPTS) -> ET.Element:
    return ET.fromstring(request_url(endpoint, params, timeout=timeout, attempts=attempts))


def chunked(items: List[str], size: int) -> Iterable[List[str]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def compact_whitespace(value: str) -> str:
    return " ".join(value.split())


def parse_month(value: Optional[str]) -> int:
    if not value:
        return 1
    raw = value.strip().lower()
    if raw.isdigit():
        return max(1, min(12, int(raw)))
    return MONTH_MAP.get(raw[:3], 1)


def parse_pub_date(article: ET.Element) -> Tuple[str, Optional[datetime]]:
    article_date = article.find("./MedlineCitation/Article/ArticleDate")
    if article_date is not None:
        year = article_date.findtext("Year")
        month = article_date.findtext("Month")
        day = article_date.findtext("Day")
        if year:
            try:
                parsed = datetime(int(year), parse_month(month), int(day or "1"))
                return parsed.strftime("%Y-%m-%d"), parsed
            except ValueError:
                pass

    pub_date = article.find("./MedlineCitation/Article/Journal/JournalIssue/PubDate")
    if pub_date is None:
        return "", None

    medline_date = pub_date.findtext("MedlineDate")
    if medline_date:
        year_fragment = medline_date[:4]
        if year_fragment.isdigit():
            parsed = datetime(int(year_fragment), 1, 1)
            return parsed.strftime("%Y-%m-%d"), parsed

    year = pub_date.findtext("Year")
    if not year or not year.isdigit():
        return "", None

    month = parse_month(pub_date.findtext("Month"))
    day_text = pub_date.findtext("Day")
    day = int(day_text) if day_text and day_text.isdigit() else 1
    try:
        parsed = datetime(int(year), month, day)
    except ValueError:
        parsed = datetime(int(year), month, 1)
    return parsed.strftime("%Y-%m-%d"), parsed


def parse_authors(article: ET.Element) -> List[str]:
    authors: List[str] = []
    for author in article.findall("./MedlineCitation/Article/AuthorList/Author"):
        collective_name = author.findtext("CollectiveName")
        if collective_name:
            authors.append(compact_whitespace(collective_name))
            continue

        last_name = author.findtext("LastName")
        fore_name = author.findtext("ForeName") or author.findtext("Initials")
        if last_name and fore_name:
            authors.append(compact_whitespace(f"{fore_name} {last_name}"))
        elif last_name:
            authors.append(compact_whitespace(last_name))
    return authors


def parse_abstract(article: ET.Element) -> str:
    parts: List[str] = []
    for abstract_node in article.findall("./MedlineCitation/Article/Abstract/AbstractText"):
        label = abstract_node.attrib.get("Label")
        text = compact_whitespace("".join(abstract_node.itertext()))
        if not text:
            continue
        parts.append(f"{label}: {text}" if label else text)
    return "\n".join(parts)


def format_author_list(authors: List[str], max_authors: int = 6) -> str:
    if not authors:
        return ""
    if len(authors) <= max_authors:
        return ", ".join(authors)
    return ", ".join(authors[:max_authors]) + ", et al."


def build_keyword_query(keywords: List[str]) -> Optional[str]:
    terms = []
    for keyword in keywords:
        normalized = keyword.strip()
        if not normalized:
            continue
        escaped = normalized.replace('"', "")
        if " " in escaped or "-" in escaped:
            terms.append(f"\"{escaped}\"[Title/Abstract]")
        else:
            terms.append(f"{escaped}[Title/Abstract]")
    if not terms:
        return None
    return "(" + " OR ".join(terms) + ")"


def search_domain_pmids(
    domain_name: str,
    keywords: Union[List[str], Dict],
    limit: int,
    date_range_days: int,
) -> List[str]:
    explicit_query = str(keywords.get("query", "")).strip() if isinstance(keywords, dict) else ""
    keyword_list = keywords.get("keywords", []) if isinstance(keywords, dict) else keywords
    keyword_query = explicit_query or build_keyword_query(keyword_list)
    if not keyword_query:
        logger.warning("Skipping domain '%s' because it has no keywords.", domain_name)
        return []

    end_date = datetime.utcnow().date()
    start_date = end_date - timedelta(days=date_range_days)
    search_term = (
        f"{keyword_query} AND hasabstract[text] AND "
        f"{start_date.strftime('%Y/%m/%d')}:{end_date.strftime('%Y/%m/%d')}[dp]"
    )

    logger.info("PubMed search for '%s' (%d keywords, limit=%d)", domain_name, len(keyword_list), limit)
    payload = request_json(
        "esearch.fcgi",
        {
            "db": "pubmed",
            "term": search_term,
            "retmode": "json",
            "retmax": str(limit),
            "sort": "pub date",
        },
    )
    return payload.get("esearchresult", {}).get("idlist", [])


def parse_pubmed_articles(root: ET.Element) -> List[Dict]:
    records: List[Dict] = []
    for article in root.findall("./PubmedArticle"):
        pmid = article.findtext("./MedlineCitation/PMID", default="").strip()
        title = compact_whitespace(
            "".join(
                article.find("./MedlineCitation/Article/ArticleTitle").itertext()
            )
        ) if article.find("./MedlineCitation/Article/ArticleTitle") is not None else ""
        abstract = parse_abstract(article)
        authors = parse_authors(article)
        published, published_date = parse_pub_date(article)
        journal = compact_whitespace(
            article.findtext("./MedlineCitation/Article/Journal/Title", default="")
        )
        publication_types = [
            compact_whitespace(node.text or "")
            for node in article.findall("./MedlineCitation/Article/PublicationTypeList/PublicationType")
            if (node.text or "").strip()
        ]

        doi = ""
        for article_id in article.findall("./PubmedData/ArticleIdList/ArticleId"):
            if article_id.attrib.get("IdType") == "doi" and (article_id.text or "").strip():
                doi = article_id.text.strip()
                break

        if not pmid or not title or not abstract:
            continue

        records.append(
            {
                "pmid": pmid,
                "title": title,
                "abstract": abstract,
                "authors": authors,
                "authors_str": format_author_list(authors),
                "published": published,
                "published_date": published_date,
                "journal": journal,
                "publication_types": publication_types,
                "doi": doi,
            }
        )

    return records


def fetch_record_batch(pmids: List[str]) -> List[Dict]:
    logger.info("Fetching PubMed metadata for %d articles", len(pmids))
    try:
        root = request_xml(
            "efetch.fcgi",
            {
                "db": "pubmed",
                "id": ",".join(pmids),
                "retmode": "xml",
            },
            timeout=60,
            attempts=5,
        )
        return parse_pubmed_articles(root)
    except Exception as err:
        if len(pmids) <= MIN_FETCH_BATCH_SIZE:
            raise

        smaller_batch_size = max(MIN_FETCH_BATCH_SIZE, len(pmids) // 2)
        logger.warning(
            "Batch efetch failed for %d PMIDs (%s). Retrying in smaller chunks of %d.",
            len(pmids),
            err,
            smaller_batch_size,
        )
        records: List[Dict] = []
        for sub_batch in chunked(pmids, smaller_batch_size):
            records.extend(fetch_record_batch(sub_batch))
        return records


def fetch_records(pmids: List[str]) -> List[Dict]:
    records: List[Dict] = []

    for batch in chunked(pmids, FETCH_BATCH_SIZE):
        records.extend(fetch_record_batch(batch))

    return records


def calculate_popularity_score(record: Dict) -> float:
    score = 0.2 if record.get("abstract") else 0.0
    journal_name = record.get("journal", "").lower()

    for journal_key, journal_score in HIGH_IMPACT_JOURNALS.items():
        if journal_key in journal_name:
            score = max(score, journal_score)
            break

    publication_types = {entry.lower() for entry in record.get("publication_types", [])}
    if {"meta-analysis", "systematic review"} & publication_types:
        score += 1.2
    elif {"practice guideline", "guideline"} & publication_types:
        score += 1.0
    elif {"randomized controlled trial", "clinical trial"} & publication_types:
        score += 0.8
    elif "review" in publication_types:
        score += 0.4

    if record.get("doi"):
        score += 0.15

    if len(record.get("abstract", "")) >= 1600:
        score += 0.15

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
                "categories": record.get("publication_types", []),
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
        final_score = calculate_recommendation_score(
            relevance,
            recency,
            popularity,
            quality,
        )

        categories = record.get("publication_types", [])[:3]
        if not categories and record.get("journal"):
            categories = [record["journal"]]

        scored_records.append(
            {
                "id": record["pmid"],
                "title": record["title"],
                "authors": record["authors_str"],
                "abstract": record["abstract"],
                "published": record["published"],
                "categories": categories,
                "relevance_score": round(relevance, 2),
                "recency_score": round(recency, 2),
                "popularity_score": round(popularity, 2),
                "quality_score": round(quality, 2),
                "final_score": final_score,
                "matched_domain": matched_domain,
                "matched_keywords": matched_keywords,
                "link": f"https://pubmed.ncbi.nlm.nih.gov/{record['pmid']}/",
                "source": "pubmed",
            }
        )

    scored_records.sort(key=lambda item: item["final_score"], reverse=True)
    return scored_records, total_filtered


def collect_pmids(config: Dict, max_results: int, date_range_days: int) -> List[str]:
    domains = get_domains(config)

    ordered_domains = sorted(
        domains.items(),
        key=lambda item: item[1].get("priority", 0),
        reverse=True,
    )
    per_domain_limit = max(20, math.ceil(max_results / max(len(ordered_domains), 1)))

    seen = set()
    ordered_pmids: List[str] = []
    for domain_name, domain_config in ordered_domains:
        domain_pmids = search_domain_pmids(
            domain_name,
            domain_config if domain_config.get("query") else domain_config.get("keywords", []),
            per_domain_limit,
            date_range_days,
        )
        logger.info("  %s: %d PMIDs", domain_name, len(domain_pmids))
        for pmid in domain_pmids:
            if pmid not in seen:
                seen.add(pmid)
                ordered_pmids.append(pmid)

    return ordered_pmids[:max_results]


def get_domains(config: Dict) -> Dict:
    domains = config.get("research_domains", {})
    if domains:
        return domains
    return {
        "Biomedical Research": {
            "keywords": ["meta-analysis", "systematic review", "PRISMA", "evidence synthesis"],
            "priority": 1,
        }
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Search and rank PubMed papers")
    parser.add_argument("--config", type=str, required=True, help="Path to research config JSON/YAML")
    parser.add_argument("--output", type=str, default="pubmed_results.json", help="Output JSON file path")
    parser.add_argument("--top-n", type=int, default=10, help="Number of papers to return")
    parser.add_argument("--max-results", type=int, default=120, help="Maximum PubMed records to fetch")
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

    pmids = collect_pmids(config, args.max_results, args.date_range_days)
    logger.info("Collected %d unique PubMed IDs", len(pmids))

    if not pmids:
        output = {
            "top_papers": [],
            "total_found": 0,
            "total_filtered": 0,
            "search_date": datetime.utcnow().strftime("%Y-%m-%d"),
        }
        with open(args.output, "w", encoding="utf-8") as handle:
            json.dump(output, handle, ensure_ascii=False, indent=2)
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0

    records = fetch_records(pmids)
    logger.info("Fetched %d PubMed records with abstracts", len(records))

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
        logger.info(
            "%d. %s... (Score: %s)",
            index,
            paper["title"][:60],
            paper["final_score"],
        )

    print(json.dumps(output, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
