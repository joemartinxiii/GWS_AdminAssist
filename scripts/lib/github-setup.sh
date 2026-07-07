#!/usr/bin/env bash
# Optional GitHub Actions secrets setup via gh CLI.

set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${LIB_DIR}/common.sh"

setup_github_secrets() {
  local project_id="$1"
  local deploy_key_path="$2"
  local repo="${3:-}"

  echo ""
  echo "=== GitHub Actions CI setup ==="
  echo ""

  if command -v gh >/dev/null 2>&1 && gh auth status &>/dev/null 2>&1; then
    log "Setting GitHub repository secrets via gh CLI..."
    local gh_args=()
    [[ -n "$repo" ]] && gh_args=(--repo "$repo")

    gh secret set GCP_PROJECT_ID --body "$project_id" "${gh_args[@]}"
    gh secret set GCP_SA_KEY < "$deploy_key_path" "${gh_args[@]}"
    echo "  OK: GCP_PROJECT_ID and GCP_SA_KEY set"

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
    open_url_hint "https://github.com/settings/tokens"
    echo "After secrets are set, push to main or run Actions → Deploy to Cloud Run → Run workflow."
  fi
}
