"""
Seznam.cz scraper — collects headline + article body pairs from zpravy.seznam.cz.

Seznam is SSR so plain requests work. Articles are publicly accessible.

Usage:
    python seznam.py --limit 50
    python seznam.py --limit 100 --output ../data/raw/seznam/
"""

import argparse
import json
import time
import re
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; clickbait-bench/0.1)",
    "Accept-Language": "cs-CZ,cs;q=0.9"
}

INDEX_URL = "https://zpravy.seznam.cz/"


def fetch_article_list(limit: int = 50) -> list[dict]:
    """
    Scrape the zpravy.seznam.cz front page for article links.
    Returns list of {title, url} dicts.
    """
    resp = requests.get(INDEX_URL, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    seen = set()
    articles = []

    # Article links on seznam.cz are consistently in <a> tags with prominent text
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not href.startswith("http"):
            href = urljoin(INDEX_URL, href)

        # Only internal zpravy.seznam.cz article links
        if "zpravy.seznam.cz" not in href:
            continue
        if href in seen:
            continue
        if any(skip in href for skip in ["/tema/", "/autor/", "/tag/", "/podcast/"]):
            continue

        text = a.get_text(strip=True)
        if len(text) < 20:
            continue

        seen.add(href)
        articles.append({"title": text, "url": href})

        if len(articles) >= limit:
            break

    return articles


def fetch_article_body(url: str) -> Optional[tuple[str, str]]:
    """
    Fetch a seznam.cz article and return (article_title, body_text).
    Returns None on failure.
    """
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        print(f"    Error fetching {url}: {e}")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    # Real article headline (may differ from the link text on index page)
    title_tag = soup.find("h1")
    article_title = title_tag.get_text(strip=True) if title_tag else None

    # Meta description
    meta = soup.find("meta", attrs={"name": re.compile("description", re.I)})
    description = meta["content"].strip() if meta and meta.get("content") else ""

    # Article body — seznam.cz uses <article> consistently
    article = soup.find("article")
    body_text = ""
    if article:
        for tag in article(["script", "style", "figure", "aside"]):
            tag.decompose()
        paragraphs = article.find_all("p")
        body_text = "\n".join(p.get_text(" ", strip=True) for p in paragraphs[:8])

    combined = "\n\n".join(filter(None, [description, body_text]))
    if len(combined) < 100:
        return None

    return article_title, combined


def collect(limit: int, output_dir: Path, delay: float = 1.5):
    output_dir.mkdir(parents=True, exist_ok=True)

    print("  Fetching article list from zpravy.seznam.cz...")
    articles = fetch_article_list(limit * 2)  # Fetch extra, some will fail
    print(f"  Found {len(articles)} candidate links")

    collected = []
    for item in articles:
        if len(collected) >= limit:
            break

        print(f"  Fetching: {item['url'][:80]}")
        result = fetch_article_body(item["url"])

        if result:
            article_title, body = result
            record = {
                "source": "seznam",
                "index_headline": item["title"],   # Headline as shown on index page
                "article_headline": article_title,  # H1 inside the article itself
                "url": item["url"],
                "article_body": body,
                "ground_truth_category": None,
                "notes": ""
            }
            collected.append(record)

        time.sleep(delay)

    out_file = output_dir / "seznam_collected.jsonl"
    with open(out_file, "w", encoding="utf-8") as f:
        for record in collected:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"\n  Saved {len(collected)} records to {out_file}")
    return collected


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--output", default="../data/raw/seznam/")
    parser.add_argument("--delay", type=float, default=1.5)
    args = parser.parse_args()

    print("Collecting from zpravy.seznam.cz...")
    collect(args.limit, Path(args.output), args.delay)
