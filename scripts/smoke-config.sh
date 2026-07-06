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
for key in TEST_SUPER_ADMIN_EMAIL JWT_SECRET GCP_PROJECT_ID WORKSPACE_DOMAIN SERVICE_ACCOUNT_SECRET_NAME; do
  if [[ -z "${!key:-}" ]]; then
    missing+=("$key")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "FAIL: Missing required keys in .env.test:"
  printf '  - %s\n' "${missing[@]}"
  exit 1
fi

if [[ -n "${SA_KEY_PATH:-}" ]]; then
  if [[ ! -f "$SA_KEY_PATH" ]]; then
    echo "FAIL: SA_KEY_PATH file not found: $SA_KEY_PATH"
    exit 1
  fi
  echo "OK: SA_KEY_PATH file exists"
else
  echo "WARN: SA_KEY_PATH not set — live tests will use Secret Manager"
fi

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
