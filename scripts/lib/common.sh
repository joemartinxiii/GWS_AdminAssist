#!/usr/bin/env bash
# Shared helpers for bootstrap scripts.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

log() { echo "==> $*"; }
warn() { echo "WARNING: $*" >&2; }
die() { echo "ERROR: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

secret_upsert() {
  local name="$1"
  local value="$2"
  echo -n "$value" | gcloud secrets create "$name" --data-file=- 2>/dev/null || \
    echo -n "$value" | gcloud secrets versions add "$name" --data-file=-
}

wait_for_enter() {
  local prompt="${1:-Press Enter when done...}"
  read -r -p "$prompt " _
}

open_url_hint() {
  local url="$1"
  echo ""
  echo "  Open: $url"
  echo ""
}
