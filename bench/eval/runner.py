"""
Offline benchmark runner — evaluates scraped headline/body pairs against an
OpenAI-compatible LLM server (llama.cpp llama-server; see server/ scripts).

For each record in the input JSONL, calls the server and records the parsed
response. Designed to be run repeatedly with different models loaded.

The system prompt and response schema mirror extension/shared/prompt.js —
keep them in sync manually.

Usage:
    # Evaluate all scraped data with the currently loaded model
    python runner.py --input ../data/raw/reddit/reddit_collected.jsonl

    # Evaluate all sources, save results tagged with model name
    python runner.py --all --model-name qwen3.5-27b

    # Consistency testing (temperature 0 should agree; if not, that's signal)
    python runner.py --input ../../test_cases.jsonl --runs 3
"""

import argparse
import json
import time
from pathlib import Path
from typing import Optional

import requests

DEFAULT_ENDPOINT = "http://localhost:5001"

VALID_CATEGORIES = {"RAGEBAIT", "CLICKBAIT", "INACCURATE", "ACCURATE", "UNDERDELIVERS"}

SYSTEM_PROMPT = """You are a headline accuracy evaluator. Assess whether a news or article headline fairly represents the actual content of the article. Headlines and articles may be in English or Czech; always answer in the language of the headline.

You will be given:
- HEADLINE: the title shown to readers before clicking
- BODY: the first part of the actual article

Classify the headline as exactly one of:
- RAGEBAIT: designed to enrage the reader; the article does not support the outrage the headline manufactures
- CLICKBAIT: intentionally provocative oversell — the article exists but is far tamer or thinner than the headline implies
- INACCURATE: slightly misleading; the framing, emphasis, or a withheld detail distorts what the article actually says
- ACCURATE: the headline represents the article fairly
- UNDERDELIVERS: the headline undersells an article that is genuinely more interesting or significant than it sounds

Respond with a JSON object with these fields, in this order:
- reader_expectation: what a typical reader would expect from the headline alone — be specific about implied scale, subject, or drama
- article_reality: what the article actually describes, noting key facts that differ from that expectation
- gap_analysis: the most important information missing or misrepresented in the headline, and whether the omission looks deliberate
- classification: one of the category tokens above
- reason: one sentence explaining the classification
- rewrite: a replacement headline that is accurate, specific, and still engaging — name the actual subject, no vague language"""

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "reader_expectation": {"type": "string"},
        "article_reality": {"type": "string"},
        "gap_analysis": {"type": "string"},
        "classification": {"enum": sorted(VALID_CATEGORIES)},
        "reason": {"type": "string"},
        "rewrite": {"type": "string"},
    },
    "required": [
        "reader_expectation", "article_reality", "gap_analysis",
        "classification", "reason", "rewrite",
    ],
    "additionalProperties": False,
}


# ─── LLM client ───────────────────────────────────────────────────────────────

def call_llm(headline: str, body: str, endpoint: str = DEFAULT_ENDPOINT) -> Optional[str]:
    """Call the server's chat completions endpoint; returns raw text output."""
    truncated = body[:2000] if len(body) > 2000 else body
    user_msg = f"HEADLINE: {headline}\n\nBODY:\n{truncated}"

    try:
        resp = requests.post(
            f"{endpoint}/v1/chat/completions",
            json={
                "model": "headcheck",
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                "max_tokens": 600,
                "temperature": 0,
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "headline_verdict",
                        "strict": True,
                        "schema": RESPONSE_SCHEMA,
                    },
                },
            },
            timeout=180,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"    LLM server error: {e}")
        return None


def get_model_name(endpoint: str) -> str:
    """Ask the server what model is loaded (standard /v1/models)."""
    try:
        resp = requests.get(f"{endpoint}/v1/models", timeout=5)
        return resp.json()["data"][0]["id"]
    except Exception:
        return "unknown"


# ─── Response parsing ─────────────────────────────────────────────────────────

def parse_response(raw: str) -> dict:
    """Parse the JSON verdict. Lenient about surrounding text."""
    result = {
        "reader_expectation": None,
        "article_reality": None,
        "gap_analysis": None,
        "classification": None,
        "reason": None,
        "rewrite": None,
        "raw": raw,
        "parse_ok": False,
    }

    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end <= start:
        return result
    try:
        obj = json.loads(raw[start:end + 1])
    except json.JSONDecodeError:
        return result

    classification = str(obj.get("classification", "")).upper()
    if classification not in VALID_CATEGORIES:
        return result

    for field in ("reader_expectation", "article_reality", "gap_analysis", "reason", "rewrite"):
        result[field] = obj.get(field)
    result["classification"] = classification
    result["parse_ok"] = True
    return result


# ─── Main evaluation loop ─────────────────────────────────────────────────────

def evaluate_file(
    input_path: Path,
    output_path: Path,
    model_name: str,
    endpoint: str = DEFAULT_ENDPOINT,
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
            raw = call_llm(headline, body, endpoint)
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
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
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
