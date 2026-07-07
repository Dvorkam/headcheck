"""
Reddit scraper — collects headline + article body pairs for offline benchmarking.

Uses the public JSON API (no authentication required for public subreddits).
Follows external links and extracts article body where possible.

Usage:
    python reddit.py --subreddits worldnews science technology --limit 50
    python reddit.py --subreddits worldnews --limit 100 --output ../data/raw/reddit/
"""

import argparse
import json
import time
import re
from pathlib import Path
from typing import Optional

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "clickbait-bench/0.1 (offline benchmarking tool)"
}

# Subreddits likely to have clickbait-adjacent content (for interesting test cases)
DEFAULT_SUBREDDITS = ["worldnews", "science", "technology", "todayilearned", "upliftingnews"]


def fetch_subreddit(subreddit: str, limit: int = 50, sort: str = "hot") -> list[dict]:
    """Fetch posts from a subreddit using the public JSON API."""
    url = f"https://www.reddit.com/r/{subreddit}/{sort}.json?limit={min(limit, 100)}"
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    posts = data["data"]["children"]

    results = []
    for post in posts:
        d = post["data"]
        if d.get("stickied") or d.get("is_video"):
            continue
        results.append({
            "id": d["id"],
            "subreddit": subreddit,
            "reddit_title": d["title"],
            "reddit_url": f"https://www.reddit.com{d['permalink']}",
            "external_url": d.get("url"),
            "is_self": d.get("is_self", False),
            "selftext": d.get("selftext", ""),
            "score": d.get("score", 0),
        })

    return results


def fetch_article_body(url: str, timeout: int = 10) -> Optional[str]:
    """
    Fetch and extract main body text from an external article URL.
    Returns None if extraction fails or content is too short.
    """
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
        resp.raise_for_status()
    except Exception as e:
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    # Remove noise
    for tag in soup(["script", "style", "nav", "header", "footer", "aside", "form"]):
        tag.decompose()

    # Meta description
    desc = ""
    meta = soup.find("meta", attrs={"name": re.compile("description", re.I)})
    if meta and meta.get("content"):
        desc = meta["content"].strip()

    # Article body: prefer <article>, fall back to <main>
    article = soup.find("article") or soup.find("main")
    body_text = ""
    if article:
        paragraphs = article.find_all("p")
        body_text = "\n".join(p.get_text(" ", strip=True) for p in paragraphs[:8])

    combined = "\n\n".join(filter(None, [desc, body_text]))
    return combined if len(combined) > 100 else None


def fetch_article_title(url: str, timeout: int = 10) -> Optional[str]:
    """Fetch the <title> tag of an external article (the real headline)."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout)
        resp.raise_for_status()
    except Exception:
        return None
    soup = BeautifulSoup(resp.text, "html.parser")
    tag = soup.find("title")
    return tag.get_text(strip=True) if tag else None


def collect(subreddits: list[str], limit: int, output_dir: Path, delay: float = 1.5):
    output_dir.mkdir(parents=True, exist_ok=True)

    collected = []
    for sub in subreddits:
        print(f"  Fetching r/{sub}...")
        try:
            posts = fetch_subreddit(sub, limit)
        except Exception as e:
            print(f"  Failed r/{sub}: {e}")
            continue

        for post in posts:
            record = {
                "source": "reddit",
                "subreddit": sub,
                "reddit_title": post["reddit_title"],
                "reddit_url": post["reddit_url"],
                "article_url": None,
                "article_title": None,
                "article_body": None,
                "ground_truth_category": None,  # filled in manually or by oracle model
                "notes": ""
            }

            if post["is_self"] and len(post["selftext"]) > 100:
                # Self post — use selftext as body
                record["article_body"] = post["selftext"][:2000]
            elif post["external_url"] and not post["external_url"].startswith("https://www.reddit.com"):
                # External link — fetch article
                ext_url = post["external_url"]
                record["article_url"] = ext_url
                print(f"    Fetching external: {ext_url[:80]}")
                record["article_title"] = fetch_article_title(ext_url)
                record["article_body"] = fetch_article_body(ext_url)
                time.sleep(delay)  # Be polite

            if record["article_body"]:
                collected.append(record)

        time.sleep(delay)

    out_file = output_dir / "reddit_collected.jsonl"
    with open(out_file, "w", encoding="utf-8") as f:
        for record in collected:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"\n  Saved {len(collected)} records to {out_file}")
    return collected


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--subreddits", nargs="+", default=DEFAULT_SUBREDDITS)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--output", default="../data/raw/reddit/")
    parser.add_argument("--delay", type=float, default=1.5, help="Delay between requests (seconds)")
    args = parser.parse_args()

    print(f"Collecting from r/{', r/'.join(args.subreddits)} ({args.limit} posts each)...")
    collect(args.subreddits, args.limit, Path(args.output), args.delay)
