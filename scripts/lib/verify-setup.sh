#!/usr/bin/env bash
# Pre/post setup verification: secrets, DWD smoke, Cloud Run health.

set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${LIB_DIR}/common.sh"
# shellcheck source=scripts/lib/scopes.sh
source "${LIB_DIR}/scopes.sh"

verify_secrets() {
  local project_id="$1"
  local missing=0

  log "Checking Secret Manager secrets in ${project_id}..."
  for secret_name in "${APP_SECRETS[@]}"; do
    if gcloud secrets describe "$secret_name" --project="$project_id" &>/dev/null; then
      echo "  OK: ${secret_name}"
    else
      echo "  MISSING: ${secret_name}"
      missing=$((missing + 1))
    fi
  done

  [[ "$missing" -eq 0 ]] || die "${missing} secret(s) missing"
}

verify_dwd() {
  local sa_key_path="$1"
  local admin_email="$2"

  log "Verifying domain-wide delegation for ${admin_email}..."
  if ! command -v npx >/dev/null 2>&1; then
    die "npx not found — run npm install in repo root first"
  fi

  (cd "$REPO_ROOT" && npx tsx scripts/verify-dwd.ts "$sa_key_path" "$admin_email")
}

verify_health() {
  local service_url="$1"

  log "Checking ${service_url}/health ..."
  local body
  body="$(curl -sf "${service_url}/health" 2>/dev/null)" || die "Health check failed — is the service deployed?"

  if echo "$body" | grep -q '"status":"ok"'; then
    echo "  OK: health endpoint returned status ok"
    echo "  $body"
  else
    die "Unexpected health response: $body"
  fi
}

verify_sa_key_policy() {
  local project_id="$1"
  local sa_name="$2"
  local test_key="/tmp/sa-key-policy-test-$$.json"

  log "Checking if SA key creation is allowed..."
  if gcloud iam service-accounts keys create "$test_key" \
    --iam-account="${sa_name}@${project_id}.iam.gserviceaccount.com" \
    --project="$project_id" --quiet 2>/dev/null; then
    rm -f "$test_key"
    echo "  OK: SA key creation allowed"
  else
    rm -f "$test_key"
    warn "SA key creation blocked by org policy. Use Workload Identity Federation for GitHub Actions."
    return 1
  fi
}
