"""
Compare results across two model runs — highlights disagreements and degradations.

Usage:
    python compare.py \
        ../data/results/qwen2.5-0.5b/reddit_collected.jsonl \
        ../data/results/qwen2.5-1.5b/reddit_collected.jsonl
"""

import argparse
import json
from pathlib import Path
from collections import Counter


SEVERITY = {
    "BLATANT_BAIT": 5,
    "RAGEBAIT": 4,
    "CLICKBAIT": 3,
    "MISLEADING": 2,
    "UNDERSELLS": 1,
    "ACCURATE": 0
}


def load(path: Path) -> dict[str, dict]:
    """Load JSONL and index by URL."""
    records = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            key = r.get("url") or r.get("reddit_url") or r.get("article_url", "")
            if key:
                records[key] = r
    return records


def compare(path_a: Path, path_b: Path):
    a = load(path_a)
    b = load(path_b)

    model_a = next(iter(a.values()), {}).get("model", path_a.parent.name)
    model_b = next(iter(b.values()), {}).get("model", path_b.parent.name)

    shared = set(a.keys()) & set(b.keys())
    print(f"\nComparing {model_a} vs {model_b}")
    print(f"Shared records: {len(shared)} (A has {len(a)}, B has {len(b)})\n")

    disagreements = []
    a_dist = Counter()
    b_dist = Counter()

    for url in shared:
        ca = a[url].get("primary_classification")
        cb = b[url].get("primary_classification")
        a_dist[ca] += 1
        b_dist[cb] += 1

        if ca != cb:
            disagreements.append({
                "url": url,
                "headline": a[url].get("reddit_title") or a[url].get("index_headline") or a[url].get("hn_title", ""),
                model_a: ca,
                model_b: cb,
                "severity_delta": (SEVERITY.get(cb, 0) - SEVERITY.get(ca, 0))
            })

    print(f"Disagreements: {len(disagreements)}/{len(shared)} ({100*len(disagreements)//max(len(shared),1)}%)\n")

    # Distribution
    print(f"{'Category':<18} {model_a:>20} {model_b:>20}")
    print("-" * 60)
    all_cats = sorted(SEVERITY.keys(), key=lambda x: -SEVERITY[x])
    for cat in all_cats:
        print(f"{cat:<18} {a_dist.get(cat,0):>20} {b_dist.get(cat,0):>20}")

    # Notable disagreements — show cases where severity changed significantly
    big_deltas = sorted(disagreements, key=lambda x: abs(x["severity_delta"]), reverse=True)[:10]
    if big_deltas:
        print(f"\nTop disagreements by severity delta:")
        for d in big_deltas:
            delta = d["severity_delta"]
            direction = "↑" if delta > 0 else "↓"
            print(f"  {direction}{abs(delta)} | {d[model_a]} → {d[model_b]}")
            print(f"     {d['headline'][:80]}")

    # Accuracy on labeled cases (if available)
    labeled_a = {k: v for k, v in a.items() if "correct" in v}
    labeled_b = {k: v for k, v in b.items() if "correct" in v}
    if labeled_a:
        acc_a = sum(1 for v in labeled_a.values() if v["correct"]) / len(labeled_a)
        print(f"\nAccuracy on labeled cases — {model_a}: {acc_a:.1%}")
    if labeled_b:
        acc_b = sum(1 for v in labeled_b.values() if v["correct"]) / len(labeled_b)
        print(f"Accuracy on labeled cases — {model_b}: {acc_b:.1%}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("results_a", help="First model results JSONL")
    parser.add_argument("results_b", help="Second model results JSONL")
    args = parser.parse_args()

    compare(Path(args.results_a), Path(args.results_b))
