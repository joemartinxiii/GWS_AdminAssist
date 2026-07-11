#!/usr/bin/env bash
# Optional GitHub Actions CI setup. Prefer Workload Identity Federation (keyless).
# Key-based GCP_SA_KEY is only a fallback when WIF cannot be configured.

set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${LIB_DIR}/common.sh"

# Primary path: keyless WIF via setup-github-ci.sh
setup_github_wif() {
  local project_id="$1"
  local repo="${2:-}"

  echo ""
  echo "=== GitHub Actions CI setup (Workload Identity Federation — keyless) ==="
  echo ""

  if [[ -z "$repo" ]]; then
    if command -v gh >/dev/null 2>&1; then
      repo="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
    fi
  fi
  if [[ -z "$repo" || "$repo" != */* ]]; then
    warn "Could not determine GitHub owner/repo. Run later:"
    echo "  bash scripts/setup-github-ci.sh ${project_id} OWNER/REPO"
    return 1
  fi

  bash "${LIB_DIR}/../setup-github-ci.sh" "$project_id" "$repo"
}

# Legacy fallback: store a deploy SA JSON key (only if org policy allows keys).
setup_github_secrets_key_fallback() {
  local project_id="$1"
  local deploy_key_path="$2"
  local repo="${3:-}"

  echo ""
  echo "=== GitHub Actions CI setup (service-account key fallback) ==="
  echo "Prefer Workload Identity Federation: bash scripts/setup-github-ci.sh ${project_id} OWNER/REPO"
  echo ""

  if [[ ! -f "$deploy_key_path" ]]; then
    warn "No deploy key at ${deploy_key_path}"
    return 1
  fi

  if command -v gh >/dev/null 2>&1 && gh auth status &>/dev/null 2>&1; then
    log "Setting GitHub repository secrets via gh CLI..."
    local gh_args=()
    [[ -n "$repo" ]] && gh_args=(--repo "$repo")

    gh secret set GCP_PROJECT_ID --body "$project_id" "${gh_args[@]}"
    gh secret set GCP_SA_KEY < "$deploy_key_path" "${gh_args[@]}"
    echo "  OK: GCP_PROJECT_ID and GCP_SA_KEY set (do not also set GCP_WIF_PROVIDER)"

    read -r -p "Trigger Deploy to Cloud Run workflow now? [y/N] " trigger
    if [[ "${trigger,,}" == "y" ]]; then
      gh workflow run deploy.yml "${gh_args[@]}" || gh workflow run "Deploy to Cloud Run" "${gh_args[@]}"
      echo "Workflow triggered. View: GitHub → Actions → Deploy to Cloud Run"
    fi
  else
    echo "gh CLI not authenticated. Set secrets manually:"
    echo ""
    echo "  GitHub → Settings → Secrets and variables → Actions"
    echo ""
    echo "  GCP_PROJECT_ID = ${project_id}"
    echo "  GCP_SA_KEY     = contents of ${deploy_key_path}"
    echo ""
    echo "After secrets are set, push to main or run Actions → Deploy to Cloud Run → Run workflow."
  fi
}

# Back-compat name used by older callers.
setup_github_secrets() {
  setup_github_secrets_key_fallback "$@"
}
