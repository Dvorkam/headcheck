"""
Offline benchmark runner — evaluates scraped headline/body pairs against KoboldCPP.

For each record in the input JSONL, calls KoboldCPP and records the parsed response.
Designed to be run repeatedly with different models loaded in KoboldCPP.

Usage:
    # Evaluate all scraped data with the currently loaded model
    python runner.py --input ../data/raw/reddit/reddit_collected.jsonl

    # Evaluate all sources, save results tagged with model name
    python runner.py --all --model-name qwen2.5-1.5b

    # Evaluate only the curated hand-labeled test cases (the 10 from the widget)
    python runner.py --input ../../test_cases.jsonl --model-name qwen2.5-0.5b
"""

import argparse
import json
import time
from pathlib import Path
from typing import Optional
import re

import requests

KOBOLD_ENDPOINT = "http://localhost:5001"

SYSTEM_PROMPT = """You are a headline accuracy evaluator. Your job is to assess whether a news or article headline fairly represents the actual content of the article.

You will be given:
- HEADLINE: the title shown to readers before clicking
- BODY: the first few paragraphs of the actual article

Generate response in following format. Follow this structure exactly:

READER EXPECTATION: What would a typical reader expect to find, based on the headline alone? Be specific about implied scale, subject, or drama.

ARTICLE REALITY: What does the article actually describe? Note any key facts that differ from expectations.

GAP ANALYSIS: What is the most important information missing from or misrepresented in the headline? Is the omission likely deliberate?

CLASSIFICATION: One of: BLATANT_BAIT / RAGEBAIT / CLICKBAIT / MISLEADING / ACCURATE / UNDERSELLS

REASON: One sentence explaining the classification.

REWRITE: A replacement headline that is accurate, specific, and still engaging."""

VALID_CATEGORIES = {"BLATANT_BAIT", "RAGEBAIT", "CLICKBAIT", "MISLEADING", "ACCURATE", "UNDERSELLS"}


# ─── KoboldCPP client ─────────────────────────────────────────────────────────

def strip_think_blocks(text: str) -> str:
    """Strip <think>...</think> blocks from reasoning models (Qwen3, etc.)"""
    import re
    return re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()


def call_kobold(headline: str, body: str, endpoint: str = KOBOLD_ENDPOINT) -> Optional[str]:
    """Call KoboldCPP and return raw text output. Tries chat completions first."""
    truncated = body[:2000] if len(body) > 2000 else body
    user_msg = f"HEADLINE: {headline}\n\nBODY:\n{truncated}"

    # Try OpenAI-compatible chat completions
    try:
        resp = requests.post(
            f"{endpoint}/v1/chat/completions",
            json={
                "model": "local",
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg}
                ],
                "max_tokens": 1200,  # Thinking models burn 400-600 tokens on <think> blocks
                "temperature": 0.3,
                "reasoning_effort": "none",
            },
            timeout=90
        )
        if resp.ok:
            raw = resp.json()["choices"][0]["message"]["content"].strip()
            return strip_think_blocks(raw)
    except Exception:
        pass

    # Fallback: native KoboldCPP generate API
    prompt = f"### System:\n{SYSTEM_PROMPT}\n\n### User:\n{user_msg}\n\n### Response:\n"
    try:
        resp = requests.post(
            f"{endpoint}/api/v1/generate",
            json={
                "prompt": prompt,
                "max_length": 1200,
                "temperature": 0.3,
                "rep_pen": 1.1,
                "stop_sequence": ["\n\n\n", "###"],
                "reasoning_effort": "none"
            },
            timeout=90
        )
        resp.raise_for_status()
        return strip_think_blocks(resp.json()["results"][0]["text"].strip())
    except Exception as e:
        print(f"    KoboldCPP error: {e}")
        return None


def get_model_name(endpoint: str) -> str:
    """Ask KoboldCPP what model is loaded."""
    try:
        resp = requests.get(f"{endpoint}/api/v1/model", timeout=5)
        return resp.json().get("result", "unknown")
    except Exception:
        return "unknown"


# ─── Response parsing ─────────────────────────────────────────────────────────

def extract_field(text: str, field: str) -> Optional[str]:
    pattern = rf"{field}\s*:\s*([\s\S]*?)(?=\n[A-Z _]+:|$)"
    m = re.search(pattern, text, re.IGNORECASE)
    return m.group(1).strip() if m else None


def parse_response(raw: str) -> dict:
    result = {
        "reader_expectation": extract_field(raw, "READER EXPECTATION"),
        "article_reality": extract_field(raw, "ARTICLE REALITY"),
        "gap_analysis": extract_field(raw, "GAP ANALYSIS"),
        "classification": None,
        "reason": extract_field(raw, "REASON"),
        "rewrite": extract_field(raw, "REWRITE"),
        "raw": raw,
        "parse_ok": False
    }
    m = re.search(
        r"CLASSIFICATION\s*:\s*(BLATANT_BAIT|RAGEBAIT|CLICKBAIT|MISLEADING|ACCURATE|UNDERSELLS)",
        raw, re.IGNORECASE
    )
    if m:
        result["classification"] = m.group(1).upper()
        result["parse_ok"] = True
    return result


# ─── Main evaluation loop ─────────────────────────────────────────────────────

def evaluate_file(
    input_path: Path,
    output_path: Path,
    model_name: str,
    endpoint: str = KOBOLD_ENDPOINT,
    delay: float = 0.5,
    runs: int = 1
):
    """Evaluate all records in a JSONL file. runs=3 for consistency testing."""
    records = []
    with open(input_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))

    print(f"  Evaluating {len(records)} records from {input_path.name}")
    print(f"  Model: {model_name}, runs per record: {runs}")

    results = []
    for i, rec in enumerate(records):
        # Choose headline depending on source
        if rec.get("source") == "reddit":
            headline = rec.get("reddit_title", "")
        elif rec.get("source") == "seznam":
            headline = rec.get("index_headline", "")
        elif rec.get("source") == "hackernews":
            headline = rec.get("hn_title", "")
        else:
            headline = rec.get("headline", "")

        body = rec.get("article_body", "")
        if not headline or not body:
            continue

        print(f"  [{i+1}/{len(records)}] {headline[:60]}")

        run_results = []
        for run in range(runs):
            raw = call_kobold(headline, body, endpoint)
            if raw:
                parsed = parse_response(raw)
                run_results.append(parsed)
            time.sleep(delay)

        if not run_results:
            continue

        # Agreement check across runs
        classifications = [r["classification"] for r in run_results if r["classification"]]
        agreed = len(set(classifications)) == 1 if classifications else False

        result_record = {
            **rec,
            "model": model_name,
            "runs": run_results,
            "primary_classification": run_results[0]["classification"],
            "primary_rewrite": run_results[0]["rewrite"],
            "runs_agree": agreed,
            "all_classifications": classifications
        }

        # If ground truth is set, mark correctness
        if rec.get("ground_truth_category"):
            result_record["correct"] = (
                result_record["primary_classification"] == rec["ground_truth_category"]
            )

        results.append(result_record)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        for r in results:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    # Quick summary stats
    total = len(results)
    parse_ok = sum(1 for r in results if r.get("primary_classification"))
    agreed = sum(1 for r in results if r.get("runs_agree"))
    labeled = [r for r in results if "correct" in r]
    accuracy = sum(1 for r in labeled if r["correct"]) / len(labeled) if labeled else None

    print(f"\n  Results: {total} evaluated, {parse_ok} parsed OK ({100*parse_ok//max(total,1)}%)")
    print(f"  Agreement across runs: {agreed}/{total}")
    if accuracy is not None:
        print(f"  Accuracy on labeled cases: {accuracy:.1%}")

    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", help="Path to input JSONL file")
    parser.add_argument("--all", action="store_true", help="Evaluate all scraped files")
    parser.add_argument("--model-name", default=None, help="Label for the model being tested")
    parser.add_argument("--endpoint", default=KOBOLD_ENDPOINT)
    parser.add_argument("--runs", type=int, default=1, help="Evaluation runs per record (use 3 for consistency testing)")
    parser.add_argument("--delay", type=float, default=0.5)
    args = parser.parse_args()

    model_name = args.model_name or get_model_name(args.endpoint)
    safe_model = model_name.replace("/", "_").replace(" ", "-")

    if args.all:
        raw_root = Path("../data/raw")
        for jsonl_file in raw_root.rglob("*.jsonl"):
            out = Path("../data/results") / safe_model / jsonl_file.name
            evaluate_file(jsonl_file, out, model_name, args.endpoint, args.delay, args.runs)
    elif args.input:
        inp = Path(args.input)
        out = Path("../data/results") / safe_model / inp.name
        evaluate_file(inp, out, model_name, args.endpoint, args.delay, args.runs)
    else:
        print("Specify --input <file> or --all")
