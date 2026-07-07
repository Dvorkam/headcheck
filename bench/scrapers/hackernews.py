"""
Hacker News scraper — collects headline + article body pairs via the official Firebase API.

HN is a good third target because:
- Clean public API, no auth needed
- Tech/science content = different domain from news clickbait
- Community is notoriously anti-clickbait, so HN titles often differ from article titles
- The delta between HN submission title vs article title is itself interesting signal

Usage:
    python hackernews.py --feed top --limit 50
    python hackernews.py --feed new --limit 100 --output ../data/raw/hackernews/
"""

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "clickbait-bench/0.1 (offline benchmarking tool)"
}

HN_API = "https://hacker-news.firebaseio.com/v0"


def fetch_feed_ids(feed: str = "top", limit: int = 100) -> list[int]:
    """Fetch item IDs from the top/new/best feed."""
    valid_feeds = {"top", "new", "best", "ask", "show"}
    if feed not in valid_feeds:
        raise ValueError(f"Feed must be one of {valid_feeds}")
    resp = requests.get(f"{HN_API}/{feed}stories.json", timeout=15)
    resp.raise_for_status()
    return resp.json()[:limit]


def fetch_item(item_id: int) -> Optional[dict]:
    """Fetch a single HN story item."""
    try:
        resp = requests.get(f"{HN_API}/item/{item_id}.json", timeout=10)
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return None


def fetch_article_body(url: str, timeout: int = 12) -> Optional[str]:
    """Extract article body from an external URL."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
        resp.raise_for_status()
    except Exception:
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    for tag in soup(["script", "style", "nav", "header", "footer", "aside"]):
        tag.decompose()

    # Meta description
    desc_tag = soup.find("meta", attrs={"name": lambda x: x and "description" in x.lower()})
    description = desc_tag["content"].strip() if desc_tag and desc_tag.get("content") else ""

    # Article body
    article = soup.find("article") or soup.find("main")
    body_text = ""
    if article:
        paragraphs = article.find_all("p")
        body_text = "\n".join(p.get_text(" ", strip=True) for p in paragraphs[:8])

    combined = "\n\n".join(filter(None, [description, body_text]))
    return combined if len(combined) > 100 else None


def fetch_article_title(url: str) -> Optional[str]:
    """Fetch the real <title> of the linked article (may differ from HN submission title)."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
    except Exception:
        return None
    soup = BeautifulSoup(resp.text, "html.parser")
    tag = soup.find("h1") or soup.find("title")
    return tag.get_text(strip=True) if tag else None


def collect(feed: str, limit: int, output_dir: Path, delay: float = 1.0):
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"  Fetching HN {feed} feed ({limit} items)...")
    ids = fetch_feed_ids(feed, limit * 2)  # Fetch extra for filtering

    collected = []
    for item_id in ids:
        if len(collected) >= limit:
            break

        item = fetch_item(item_id)
        if not item or item.get("type") != "story":
            continue
        if not item.get("url"):
            # Self post (Ask HN, etc.) — no external article
            continue

        url = item["url"]
        hn_title = item.get("title", "")

        print(f"  [{len(collected)+1}/{limit}] {hn_title[:60]}")

        article_title = fetch_article_title(url)
        article_body = fetch_article_body(url)

        if not article_body:
            time.sleep(delay)
            continue

        record = {
            "source": "hackernews",
            "hn_title": hn_title,           # Title as submitted to HN (often editorialised)
            "article_title": article_title,  # Real <h1> or <title> from article
            "url": url,
            "hn_item_id": item_id,
            "hn_score": item.get("score", 0),
            "article_body": article_body,
            "ground_truth_category": None,
            "notes": ""
            # Note: hn_title vs article_title delta is worth examining separately —
            # HN submitters often rewrite titles to be more accurate/less clickbaity.
        }

        collected.append(record)
        time.sleep(delay)

    out_file = output_dir / "hackernews_collected.jsonl"
    with open(out_file, "w", encoding="utf-8") as f:
        for record in collected:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"\n  Saved {len(collected)} records to {out_file}")
    return collected


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--feed", choices=["top", "new", "best"], default="top")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--output", default="../data/raw/hackernews/")
    parser.add_argument("--delay", type=float, default=1.0)
    args = parser.parse_args()

    print(f"Collecting from Hacker News ({args.feed} feed)...")
    collect(args.feed, args.limit, Path(args.output), args.delay)
