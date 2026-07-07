# Headcheck

A Chrome extension that evaluates headline accuracy using a local LLM served by
llama.cpp (`llama-server`). Includes an offline benchmarking suite for testing
models before committing to one.

## Project structure

```
headcheck/
├── extension/               Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── background/
│   │   ├── service-worker.js   Orchestrates fetch → extract → LLM → cache
│   │   └── llm-client.js       OpenAI-compatible chat client (llama-server)
│   ├── content/
│   │   └── scanner.js          DOM scanner + badge injector
│   ├── shared/
│   │   ├── categories.js       Category definitions (single source of truth)
│   │   └── prompt.js           Prompt template, JSON schema, response parser
│   └── options/
│       ├── options.html
│       └── options.js
│
├── server/                  llama-server launch scripts
│   ├── start-llama-server.sh   Linux
│   └── start-llama-server.bat  Windows
│
└── bench/                   Offline benchmarking (Python)
    ├── requirements.txt
    ├── scrapers/
    │   ├── reddit.py           Reddit public JSON API
    │   ├── seznam.py           zpravy.seznam.cz (SSR scrape)
    │   └── hackernews.py       HN Firebase API + article fetch
    ├── eval/
    │   ├── runner.py           Evaluate scraped data against the LLM server
    │   └── compare.py          Diff two model result sets
    └── data/
        ├── raw/                Scraped headline/body pairs (gitignored)
        └── results/            Per-model evaluation output (gitignored)
```

## Step 1 — Start the LLM server

Requires a recent [llama.cpp](https://github.com/ggml-org/llama.cpp) build with CUDA.

```bash
# Linux (WSL2)
./server/start-llama-server.sh

# Windows
server\start-llama-server.bat
```

Defaults: `Qwen3.5-27B-UD-Q5_K_XL.gguf` from `~/models`, port `5001`, full GPU
offload sized for an RTX 3090. Override via env vars (`HEADCHECK_MODEL`,
`HEADCHECK_PORT`, `HEADCHECK_CTX`, `LLAMA_SERVER`).

## Step 2 — Load the extension

1. Go to `chrome://extensions`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `extension/` folder

The extension talks to any OpenAI-compatible server (default endpoint:
`http://localhost:5001`) and requests grammar-constrained JSON via
`response_format: json_schema`, so responses always parse.

## Step 3 — Collect benchmark data

```bash
cd bench
pip install -r requirements.txt

# Scrape all three sources
python scrapers/reddit.py --subreddits worldnews science technology --limit 50
python scrapers/seznam.py --limit 50
python scrapers/hackernews.py --feed top --limit 50
```

Raw data lands in `bench/data/raw/{source}/`.

## Step 4 — Run the benchmark against each model

Load a model in llama-server, then:

```bash
cd bench

# Evaluate all scraped data (tags results with model name from /v1/models)
python eval/runner.py --all

# Or evaluate a specific file with a custom model label
python eval/runner.py \
    --input data/raw/reddit/reddit_collected.jsonl \
    --model-name qwen3.5-27b \
    --runs 3
```

Results land in `bench/data/results/<model-name>/`.

## Step 5 — Compare models

```bash
python eval/compare.py \
    data/results/qwen3.5-27b/reddit_collected.jsonl \
    data/results/qwen3-4b/reddit_collected.jsonl
```

## Step 6 — Label ground truth (optional but useful)

Open any `*_collected.jsonl` file and set `"ground_truth_category"` on records you've
manually evaluated. The runner will then calculate accuracy automatically.

Use the category tokens: `RAGEBAIT / CLICKBAIT / INACCURATE / ACCURATE / UNDERDELIVERS`

## Categories

| Token | Meaning | Severity |
|---|---|---|
| `RAGEBAIT` | Designed to enrage; the article doesn't support the outrage | 4 |
| `CLICKBAIT` | Intentionally provocative oversell of the actual content | 3 |
| `INACCURATE` | Slightly misleading; framing or emphasis distorts the article | 2 |
| `UNDERDELIVERS` | Headline undersells a genuinely interesting article | 1 |
| `ACCURATE` | Headline represents the article fairly | 0 |

## Model plan

Current baseline: Qwen3.5-27B (Unsloth dynamic Q5_K_XL) as prompted evaluator.
Long-term: distill to a fine-tuned Qwen3-4B student (see `.claude/Plan/`) for
fast per-headline verdicts.

## Notes

- The `data/` directory is gitignored — scraped content stays local.
- The LLM endpoint is configurable per extension instance (options page).
- The prompt template and JSON schema exist in two places —
  `extension/shared/prompt.js` and `bench/eval/runner.py` — and must be kept
  in sync manually if changed.
- Privacy: article fetches are anonymous (no cookies), except reddit.com where
  the user's own session is used to avoid anonymous-API rate limits. Content
  goes only to the user's local LLM server.
