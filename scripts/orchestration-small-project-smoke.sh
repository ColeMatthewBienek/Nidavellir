#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"

run_smoke() {
  cd "$ROOT/backend"
  PYTHONPATH="$ROOT/backend${PYTHONPATH:+:$PYTHONPATH}" uv run python ../scripts/orchestration-small-project-smoke.py
}

if command -v uv >/dev/null 2>&1; then
  run_smoke
  exit 0
fi

if command -v wsl.exe >/dev/null 2>&1 && command -v cygpath >/dev/null 2>&1; then
  win_root="$(cygpath -w "$ROOT")"
  drive="$(printf '%s' "$win_root" | cut -c1 | tr '[:upper:]' '[:lower:]')"
  rest="$(printf '%s' "$win_root" | cut -c3- | tr '\\' '/')"
  wsl_root="/mnt/${drive}${rest}"
  wsl.exe -e bash -lc "export PATH=\"\$HOME/.local/bin:\$PATH\" && cd '$wsl_root/backend' && PYTHONPATH='$wsl_root/backend' uv run python ../scripts/orchestration-small-project-smoke.py"
  exit 0
fi

echo "uv is required to run the orchestration smoke." >&2
exit 127
