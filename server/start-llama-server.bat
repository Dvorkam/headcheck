@echo off
rem Start llama-server for headcheck — tuned for RTX 3090 (24 GB VRAM) + 128 GB RAM.
rem
rem Requires a recent llama.cpp CUDA build (2025+) on PATH, or set LLAMA_SERVER
rem to the full path of llama-server.exe.
rem Override defaults by setting environment variables before running.

setlocal

if "%LLAMA_SERVER%"==""    set "LLAMA_SERVER=llama-server.exe"
if "%HEADCHECK_MODEL%"=="" set "HEADCHECK_MODEL=%USERPROFILE%\models\Qwen3.5-27B-UD-Q5_K_XL.gguf"
if "%HEADCHECK_HOST%"==""  set "HEADCHECK_HOST=127.0.0.1"
if "%HEADCHECK_PORT%"==""  set "HEADCHECK_PORT=37848"
if "%HEADCHECK_CTX%"==""   set "HEADCHECK_CTX=16384"

if not exist "%HEADCHECK_MODEL%" (
  echo Model not found: %HEADCHECK_MODEL%
  echo Set HEADCHECK_MODEL to the .gguf path.
  pause
  exit /b 1
)

rem VRAM budget: 27B @ Q5_K_XL is ~19 GB of weights. Full GPU offload plus
rem q8_0 KV cache at 16K context fits a 3090 with a little headroom.
rem If you hit CUDA OOM: first drop HEADCHECK_CTX to 8192, then reduce
rem --n-gpu-layers (e.g. 40) to spill the remainder to system RAM.
"%LLAMA_SERVER%" ^
  --model "%HEADCHECK_MODEL%" ^
  --alias headcheck ^
  --host %HEADCHECK_HOST% ^
  --port %HEADCHECK_PORT% ^
  --n-gpu-layers 99 ^
  --ctx-size %HEADCHECK_CTX% ^
  --parallel 2 ^
  --flash-attn on ^
  --cache-type-k q8_0 ^
  --cache-type-v q8_0 ^
  --jinja ^
  --reasoning-budget 0

pause
