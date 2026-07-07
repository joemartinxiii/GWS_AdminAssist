#!/usr/bin/env bash
# Pre-flight config smoke for live staging tests.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env.test"

echo "=== Live staging config smoke ==="

if [[ ! -f "$ENV_FILE" ]]; then
  echo "FAIL: .env.test not found. Copy .env.test.example and fill in values."
  echo "See docs/STAGING_TEST_SETUP.md"
  exit 1
fi

# shellcheck disable=SC1090
set -a && source "$ENV_FILE" && set +a

missing=()
for key in TEST_SUPER_ADMIN_EMAIL JWT_SECRET GCP_PROJECT_ID WORKSPACE_DOMAIN; do
  if [[ -z "${!key:-}" ]]; then
    missing+=("$key")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "FAIL: Missing required keys in .env.test:"
  printf '  - %s\n' "${missing[@]}"
  exit 1
fi

if [[ -n "${SERVICE_ACCOUNT_EMAIL:-}" ]]; then
  echo "OK: SERVICE_ACCOUNT_EMAIL set ($SERVICE_ACCOUNT_EMAIL)"
else
  echo "WARN: SERVICE_ACCOUNT_EMAIL not set — the SA will be inferred from ADC credentials"
fi
echo "Keyless: ensure ADC is set (gcloud auth application-default login) with tokenCreator on the SA."

optional=(TEST_GROUP_EMAIL TEST_MY_DRIVE_FILE_ID TEST_SHARED_DRIVE_ID TEST_SHARED_DRIVE_FILE_ID)
for key in "${optional[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "WARN: Optional $key not set — some tests will skip"
  else
    echo "OK: $key set"
  fi
done

echo "OK: Required .env.test variables present"
echo "Run: npm run test:live:read"
