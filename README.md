# Clickbait Detector

A Chrome extension that evaluates headline accuracy using a local LLM via KoboldCPP.
Includes an offline benchmarking suite for testing models before committing to one.

## Project structure

```
clickbait-detector/
├── extension/               Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── background/
│   │   ├── service-worker.js   Orchestrates fetch → extract → LLM → cache
│   │   └── kobold.js           KoboldCPP API client
│   ├── content/
│   │   └── scanner.js          DOM scanner + badge injector
│   ├── shared/
│   │   ├── categories.js       Category definitions (single source of truth)
│   │   └── prompt.js           Prompt template + response parser
│   └── options/
│       ├── options.html
│       └── options.js
│
└── bench/                   Offline benchmarking (Python)
    ├── requirements.txt
    ├── scrapers/
    │   ├── reddit.py           Reddit public JSON API
    │   ├── seznam.py           zpravy.seznam.cz (SSR scrape)
    │   └── hackernews.py       HN Firebase API + article fetch
    ├── eval/
    │   ├── runner.py           Evaluate scraped data against KoboldCPP
    │   └── compare.py          Diff two model result sets
    └── data/
        ├── raw/                Scraped headline/body pairs (gitignored)
        │   ├── reddit/
        │   ├── seznam/
        │   └── hackernews/
        └── results/            Per-model evaluation output (gitignored)
```

## Step 1 — Load the extension

1. Go to `chrome://extensions`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `extension/` folder

Then open the extension options and set your KoboldCPP endpoint (default: `http://localhost:5001`).

**KoboldCPP must be started with `--openai-api`** to enable the chat completions endpoint.
The extension falls back to the native `/api/v1/generate` API if chat completions is unavailable.

## Step 2 — Collect benchmark data

```bash
cd bench
pip install -r requirements.txt

# Scrape all three sources
python scrapers/reddit.py --subreddits worldnews science technology --limit 50
python scrapers/seznam.py --limit 50
python scrapers/hackernews.py --feed top --limit 50
```

Raw data lands in `bench/data/raw/{source}/`.

## Step 3 — Run the benchmark against each model

Load a model in KoboldCPP, then:

```bash
cd bench

# Evaluate all scraped data (tags results with model name from KoboldCPP)
python eval/runner.py --all

# Or evaluate a specific file with a custom model label
python eval/runner.py \
    --input data/raw/reddit/reddit_collected.jsonl \
    --model-name qwen2.5-1.5b \
    --runs 3
```

Results land in `bench/data/results/<model-name>/`.

## Step 4 — Compare models

```bash
python eval/compare.py \
    data/results/qwen2.5-0.5b/reddit_collected.jsonl \
    data/results/qwen2.5-1.5b/reddit_collected.jsonl
```

## Step 5 — Label ground truth (optional but useful)

Open any `*_collected.jsonl` file and set `"ground_truth_category"` on records you've
manually evaluated. The runner will then calculate accuracy automatically.

Use the category tokens: `BLATANT_BAIT / RAGEBAIT / CLICKBAIT / MISLEADING / ACCURATE / UNDERSELLS`

## Recommended model ladder for KoboldCPP

Test in this order and stop when quality is satisfactory:

| Model | Parameter for `--model-name` |
|---|---|
| Qwen2.5-0.5B-Instruct-Q5_K_M | qwen2.5-0.5b |
| Qwen2.5-1.5B-Instruct-Q5_K_M | qwen2.5-1.5b |
| Qwen2.5-3B-Instruct-Q5_K_M   | qwen2.5-3b |
| Qwen2.5-7B-Instruct-Q5_K_M   | qwen2.5-7b |

Czech quality likely improves noticeably between 1.5B and 3B.

## Notes

- The `data/` directory is gitignored — scraped content stays local.
- KoboldCPP endpoint is configurable per extension instance (options page).
- The prompt template in `extension/shared/prompt.js` and `bench/eval/runner.py`
  must be kept in sync manually if you change it.
