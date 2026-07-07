#!/usr/bin/env bash
# Shared helpers for bootstrap scripts.

set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${LIB_DIR}/../.." && pwd)"

log() { echo "==> $*"; }
warn() { echo "WARNING: $*" >&2; }
die() { echo "ERROR: $*" >&2; exit 1; }

# In Cloud Shell, gcloud prints benign chatter to stderr that alarms first-time
# users but has no effect on any command: a context-aware-access lookup that
# 404s ("Regional Access Boundary HTTP request failed ... Account not found")
# and an environment-tag nag ("[environment: untagged] ... project-env-tag").
# Wrap gcloud to strip ONLY those exact lines, preserving stdout, real errors,
# warnings, and the true exit code. Set GWS_SHOW_GCLOUD_NOISE=1 to see them.
_GCLOUD_NOISE_RE='Regional Access Boundary HTTP request failed|\[environment: untagged\]'
gcloud() {
  if [[ "${GWS_SHOW_GCLOUD_NOISE:-0}" == "1" ]]; then
    command gcloud "$@"
  else
    command gcloud "$@" 2> >(grep -vE "$_GCLOUD_NOISE_RE" >&2)
  fi
}

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

# Prompt with an optional default. The prompt is written to stderr (via read -p)
# so this is safe to use inside $(...) command substitution.
# Usage: value="$(prompt_default "Question" "default-value")"
prompt_default() {
  local prompt="$1"
  local default="${2:-}"
  local answer=""
  if [[ -n "$default" ]]; then
    read -r -p "${prompt} [${default}]: " answer
    echo "${answer:-$default}"
  else
    read -r -p "${prompt}: " answer
    echo "$answer"
  fi
}

# Yes/no confirm. Returns 0 for yes. Default is yes unless $2 == "n".
confirm() {
  local prompt="$1"
  local default="${2:-y}"
  local answer=""
  local hint="[Y/n]"
  [[ "$default" == "n" ]] && hint="[y/N]"
  read -r -p "${prompt} ${hint}: " answer
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy] ]]
}

open_url_hint() {
  local url="$1"
  echo ""
  echo "  Open: $url"
  echo ""
}
