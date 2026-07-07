#!/usr/bin/env bash
# Single source of truth for OAuth consent and DWD scope strings.
# Keep SERVICE_ACCOUNT scopes in sync with backend/src/config/google.config.ts — run: npm run check:scopes

# Domain-wide delegation (service account client_id in admin.google.com)
DWD_SCOPES="https://www.googleapis.com/auth/admin.directory.user,https://www.googleapis.com/auth/admin.directory.group,https://www.googleapis.com/auth/admin.directory.orgunit.readonly,https://www.googleapis.com/auth/admin.directory.user.security,https://www.googleapis.com/auth/apps.security,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/gmail.settings.basic,https://www.googleapis.com/auth/gmail.settings.sharing,https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/admin.directory.resource.calendar,https://www.googleapis.com/auth/chrome.management.policy,https://www.googleapis.com/auth/cloud-identity.policies.readonly"

# OAuth consent screen (user sign-in scopes — readonly)
OAUTH_CONSENT_SCOPES="https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/userinfo.profile,https://www.googleapis.com/auth/admin.directory.user.readonly,https://www.googleapis.com/auth/admin.directory.group.readonly,https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/calendar.readonly"

# APIs to enable (includes chromepolicy for chrome.management.policy DWD scope,
# and iamcredentials for keyless domain-wide delegation via signJwt)
GCP_APIS=(
  run.googleapis.com
  secretmanager.googleapis.com
  cloudbuild.googleapis.com
  artifactregistry.googleapis.com
  iamcredentials.googleapis.com
  admin.googleapis.com
  drive.googleapis.com
  gmail.googleapis.com
  calendar-json.googleapis.com
  chromepolicy.googleapis.com
  cloudidentity.googleapis.com
)

# Secret Manager secret names used by Cloud Run.
# NOTE: no service-account-key — domain-wide delegation is keyless (the runtime
# SA signs its own delegation tokens via the IAM Credentials API).
APP_SECRETS=(
  oauth-client-id
  oauth-client-secret
  oauth-redirect-uri
  app-jwt-secret
  app-workspace-domain
  app-allowed-domains
)

RUNTIME_SA="workspace-admin-sa"
DEPLOY_SA="github-deploy-sa"
ARTIFACT_REPO="workspace-admin-repo"
CLOUD_RUN_SERVICE="workspace-admin"
# On-demand external-sharing scan worker (Cloud Run Job, same image).
CLOUD_RUN_SCAN_JOB="workspace-admin-scan"
DEFAULT_REGION="us-central1"
