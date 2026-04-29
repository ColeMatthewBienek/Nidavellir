#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"

FULL=0
if [[ "${1:-}" == "--full" ]]; then
  FULL=1
fi

changed_files() {
  if [[ -n "${TEST_FEATURE_CHANGED_FILES:-}" ]]; then
    printf '%s\n' "$TEST_FEATURE_CHANGED_FILES"
    return
  fi

  cd "$ROOT"
  {
    git diff --name-only --diff-filter=ACMR HEAD --
    git ls-files --others --exclude-standard
  } | sort -u
}

has_changed_path() {
  local prefix="$1"
  grep -Eq "^${prefix}" <<<"$CHANGED"
}

run_backend_tests() {
  if command -v uv >/dev/null 2>&1; then
    cd "$ROOT/backend"
    uv run pytest -s
    return
  fi

  if command -v wsl.exe >/dev/null 2>&1 && command -v cygpath >/dev/null 2>&1; then
    local win_root drive rest wsl_root
    win_root="$(cygpath -w "$ROOT")"
    drive="$(printf '%s' "$win_root" | cut -c1 | tr '[:upper:]' '[:lower:]')"
    rest="$(printf '%s' "$win_root" | cut -c3- | tr '\\' '/')"
    wsl_root="/mnt/${drive}${rest}"
    wsl.exe -e bash -lc "cd '$wsl_root/backend' && uv run pytest -s"
    return
  fi

  echo "uv is required to run the backend suite with declared dependencies." >&2
  exit 127
}

run_frontend_tests() {
  cd "$ROOT/frontend"
  npm run typecheck
  npx playwright test --reporter=line
  npm test
}

run_electron_tests() {
  cd "$ROOT/electron"
  npm run build
}

CHANGED="$(changed_files)"

if [[ "$FULL" -eq 1 ]]; then
  echo "Running full feature gate."
  run_backend_tests
  run_frontend_tests
  run_electron_tests
  exit 0
fi

if [[ -z "$CHANGED" ]]; then
  echo "No changed files detected; skipping feature tests. Use --full to run the complete gate."
  exit 0
fi

echo "Changed files:"
printf '%s\n' "$CHANGED" | sed 's/^/  - /'

ran=0

if has_changed_path "backend/"; then
  run_backend_tests
  ran=1
fi

if has_changed_path "frontend/"; then
  run_frontend_tests
  ran=1
fi

if has_changed_path "electron/"; then
  run_electron_tests
  ran=1
fi

if grep -Eq '^(package(-lock)?\.json|scripts/test-feature\.sh)$' <<<"$CHANGED"; then
  echo "Tooling-only changes detected; no app test suite selected. Use --full for release-level verification."
  ran=1
fi

if [[ "$ran" -eq 0 ]]; then
  echo "No app code changed; skipping feature tests. Use --full to run the complete gate."
fi
