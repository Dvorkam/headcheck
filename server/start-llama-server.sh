#!/usr/bin/env bash
# Start llama-server for headcheck — tuned for RTX 3090 (24 GB VRAM) + 128 GB RAM.
#
# Requires a recent llama.cpp build (2025+) with CUDA support.
# Override any of these via environment variables, e.g.:
#   HEADCHECK_MODEL=~/models/other.gguf ./start-llama-server.sh

set -euo pipefail

LLAMA_SERVER="${LLAMA_SERVER:-llama-server}"
MODEL="${HEADCHECK_MODEL:-$HOME/models/Qwen3.5-27B-UD-Q5_K_XL.gguf}"
HOST="${HEADCHECK_HOST:-127.0.0.1}"
PORT="${HEADCHECK_PORT:-37848}"      # matches the extension's default endpoint
CTX="${HEADCHECK_CTX:-16384}"       # total; split across parallel slots

if [[ ! -f "$MODEL" ]]; then
  echo "Model not found: $MODEL" >&2
  echo "Set HEADCHECK_MODEL to the .gguf path." >&2
  exit 1
fi

# VRAM budget: 27B @ Q5_K_XL is ~19 GB of weights. Full GPU offload plus
# q8_0 KV cache at 16K context fits a 3090 with a little headroom.
# If you hit CUDA OOM: first drop HEADCHECK_CTX to 8192, then reduce
# --n-gpu-layers (e.g. 40) to spill the remainder to system RAM.
exec "$LLAMA_SERVER" \
  --model "$MODEL" \
  --alias headcheck \
  --host "$HOST" \
  --port "$PORT" \
  --n-gpu-layers 99 \
  --ctx-size "$CTX" \
  --parallel 2 \
  --flash-attn on \
  --cache-type-k q8_0 \
  --cache-type-v q8_0 \
  --jinja \
  --reasoning-budget 0
