#!/usr/bin/env bash
# Guided Google Workspace Admin Console steps (deep links + copy-paste blocks).

set -euo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.sh
source "${LIB_DIR}/common.sh"
# shellcheck source=scripts/lib/scopes.sh
source "${LIB_DIR}/scopes.sh"

guide_oauth_setup() {
  local project_id="$1"

  echo ""
  echo "=== OAuth consent screen + Web client (GCP Console) ==="
  echo ""
  echo "Step 1 — OAuth consent screen scopes (readonly, for user sign-in):"
  echo ""
  echo "$OAUTH_CONSENT_SCOPES"
  echo ""
  open_url_hint "https://console.cloud.google.com/apis/credentials/consent?project=${project_id}"
  wait_for_enter "Press Enter when consent screen scopes are saved..."

  echo ""
  echo "Step 2 — Create OAuth Web application client:"
  echo "  - Application type: Web application"
  echo "  - Authorized redirect URI (placeholder — deploy updates the real URL):"
  echo "    https://PLACEHOLDER.run.app/api/auth/callback"
  echo ""
  open_url_hint "https://console.cloud.google.com/apis/credentials/wizard?project=${project_id}"
  wait_for_enter "Press Enter when OAuth client is created..."
}

prompt_oauth_credentials() {
  local client_id client_secret
  read -r -p "Paste OAuth Web Client ID: " client_id
  read -r -s -p "Paste OAuth Web Client Secret: " client_secret
  echo ""
  echo "$client_id"
  echo "$client_secret"
}

guide_dwd_setup() {
  local sa_client_id="$1"

  echo ""
  echo "=== Domain-wide delegation (Google Workspace Admin) ==="
  echo ""
  echo "This is the ONLY step that must be done in admin.google.com."
  echo ""
  echo "1. Open Domain-wide delegation:"
  open_url_hint "https://admin.google.com/ac/owl/domainwidedelegation"
  echo "2. Click 'Add new' (or Manage API client access)"
  echo "3. Client ID — use the SERVICE ACCOUNT numeric ID (NOT the OAuth web client ID):"
  echo ""
  echo "   ${sa_client_id}"
  echo ""
  echo "4. OAuth scopes (comma-delimited, no spaces after commas):"
  echo ""
  echo "$DWD_SCOPES"
  echo ""
  wait_for_enter "Press Enter when DWD is saved in Workspace Admin..."
}

guide_oauth_redirect_after_deploy() {
  local project_id="$1"
  local redirect_uri="$2"

  echo ""
  echo "=== Add production redirect URI to OAuth client ==="
  echo ""
  echo "Add EXACTLY this URI to your OAuth Web client authorized redirect URIs:"
  echo ""
  echo "  ${redirect_uri}"
  echo ""
  open_url_hint "https://console.cloud.google.com/apis/credentials?project=${project_id}"
  wait_for_enter "Press Enter when redirect URI is registered..."
}
