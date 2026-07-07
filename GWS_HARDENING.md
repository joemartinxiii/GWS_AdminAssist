# Google Workspace Hardening Implementation

## Overview

The GWS Hardening feature provides automated security checks based on your hardening checklist. It checks various Google Workspace security settings and DNS records to ensure your organization follows security best practices.

## Features

The catalog mirrors the source hardening checklist 1:1. Most non-DNS settings are
read automatically from the **Cloud Identity Policy API** (`policies.list`); the
remainder are labelled **manual** with a direct Admin console link because Google
does not expose them via API.

Legend: ✅ auto (Policy API / DNS / user-proxy / Chrome Policy) · 📋 manual (verify in console)

1. **Authentication**
   - ✅ 2-Step Verification (user enrollment rate proxy)
   - ✅ Strong Password Policy (`security.password`)
   - ✅ Advanced Protection Program (`security.advanced_protection_program`)

2. **Email**
   - ✅ SPF / DKIM / DMARC (DNS checks)
   - 📋 Email Read Receipts (not in Policy API)
   - ✅ Mail Delegation (`gmail.mail_delegation`)
   - ✅ Confidential Mode (`gmail.confidential_mode`)
   - ✅ Email Receiving Security / restrict delivery (`gmail.restrict_delivery`)
   - 📋 Warn for External Recipients (not in Policy API)
   - ✅ Enhanced Pre-Delivery Scanning (`gmail.enhanced_pre_delivery_message_scanning`)
   - ✅ Spam Filter Bypass (`gmail.spam_override_lists`)
   - ✅ Automatic Forwarding (`gmail.auto_forwarding`)

3. **Advanced Phishing & Malware**
   - ✅ Attachments (`gmail.email_attachment_safety`)
   - ✅ External Links & Images (`gmail.links_and_external_images`)
   - ✅ Spoofing & Authentication (`gmail.spoofing_and_authentication`)

4. **Calendar**
   - ✅ Primary Calendar Sharing (`calendar.primary_calendar_max_allowed_external_sharing`)
   - ✅ Secondary Calendar Sharing (`calendar.secondary_calendar_max_allowed_external_sharing`)
   - ✅ External Invitation Warning (`calendar.external_invitations`)

5. **Google Drive**
   - ✅ Link Sharing / external (`drive_and_docs.external_sharing`)
   - ✅ General Access Default (`drive_and_docs.general_access_default`)
   - ✅ Shared Drive Creation (`drive_and_docs.shared_drive_creation`)
   - ✅ Sharing Suggestions — surfaced value, tradeoff (`drive_and_docs.external_sharing`)
   - 📋 Offline Access (not in Policy API)
   - ✅ Drive for Desktop (`drive_and_docs.drive_for_desktop`)
   - 📋 Docs/Sheets Add-ons (not in Policy API)
   - ✅ DLP — Enterprise (`rule.dlp`, pass if rules configured)

6. **Chrome Managed Browsers**
   - ✅ Browser Updates (Chrome Policy API)
   - ✅ Company-Enforced Extensions (Chrome Policy API)
   - 📋 Admin Alerts (alert-rule config not in Policy API)

7. **Login Challenges**
   - ✅ Additional Verification / employee ID (`security.login_challenges`)
   - 📋 Post-SSO Verification (not in Policy API)

8. **Data Download**
   - ✅ Google Takeout (`takeout.service_status`)
   - ✅ Less Secure Apps (`security.less_secure_apps`)

9. **Apps Control**
   - 📋 Context-Aware Access (Enterprise, context-specific)
   - 📋 Core Apps (per-OU/service decision)
   - 📋 Additional Apps (per-OU/service decision)

> When the Policy API is unavailable (not enabled, missing scope, or the caller is
> not a super admin), every ✅ Policy-API check degrades gracefully to 📋 manual and
> a single **Automated Policy Checks** warning explains how to turn it on.

## API Endpoints

### GET /api/audit/hardening
Returns all hardening checks with status and recommendations.

**Response:**
```json
{
  "checks": [
    {
      "id": "2fa-enforcement",
      "category": "Authentication",
      "name": "2FA Authentication",
      "description": "Two-step verification enforcement",
      "status": "pass",
      "currentValue": "85% of users have 2FA enforced",
      "recommendedValue": "Enforced for all users",
      "recommendation": "Enforcement should be ON for all users",
      "adminConsoleUrl": "https://admin.google.com/ac/security/2sv"
    }
  ],
  "statistics": {
    "total": 25,
    "pass": 5,
    "warning": 3,
    "fail": 2,
    "info": 4,
    "manual": 15
  }
}
```

### GET /api/audit/hardening/export
Exports hardening checks to CSV format.

### POST /api/audit/hardening/export/drive
Uploads the hardening export to Drive (requires backend + user session as implemented).

## Status Types

- **pass**: ✅ Check passed (meets recommendation)
- **warning**: ⚠️ Check has issues or couldn't be verified
- **fail**: ❌ Check failed (doesn't meet recommendation)
- **info**: ℹ️ Org-dependent setting with no universal "right" answer (e.g. mail
  delegation, calendar sharing, sharing suggestions, optional login challenges).
  Surfaced for awareness — "keep off unless there is a business need" — and
  **not counted** in the compliance score.
- **manual**: 📋 Requires manual verification in Admin Console

The compliance percentage is computed over **graded** checks only
(`pass` / (`pass` + `warning` + `fail`)); `info` and `manual` are neutral.

## DNS Checks

The DNS checking service validates:
- **SPF**: Checks for `v=spf1` record and validates hard fail (`-all`)
- **DKIM**: Checks for DKIM record and validates key size (prefers 2048-bit)
- **DMARC**: Checks for `_dmarc` record and validates policy (p=none minimum)

DNS checks use Node.js built-in `dns` module - no external dependencies required.

## Cloud Identity Policy API

Most Gmail/Drive/Calendar/Security settings are read from the Cloud Identity
Policy API (`GET https://cloudidentity.googleapis.com/v1/policies`). The app calls
the REST endpoint directly with a keyless delegated bearer token, so no client
library upgrade is required. See `backend/src/services/policy.service.ts`.

**Requirements:**
- `cloudidentity.googleapis.com` enabled in GCP (added to `scripts/lib/scopes.sh`).
- DWD scope `https://www.googleapis.com/auth/cloud-identity.policies.readonly` added to the service account.
- The audit must run as a **super administrator** (the Policy API rejects non-super admins).

## Chrome Policy API

The Chrome Policy API integration checks browser update policies and
company-enforced extensions. Requires `chromepolicy.googleapis.com` enabled and the
`chrome.management.policy` DWD scope.

## Setup Instructions

### 1. Enable the APIs

```bash
gcloud services enable chromepolicy.googleapis.com cloudidentity.googleapis.com --project=YOUR_PROJECT_ID
```

(Both are already listed in `scripts/lib/scopes.sh` → `GCP_APIS` and enabled by the bootstrap/deploy scripts.)

### 2. Update Domain-Wide Delegation

In **admin.google.com → Security → API controls → Domain-wide delegation**, ensure the
service account client ID is authorized for the full DWD scope list (run `npm run check:scopes`
to confirm `google.config.ts` and `scopes.sh` agree). The two scopes relevant here:
- `https://www.googleapis.com/auth/chrome.management.policy`
- `https://www.googleapis.com/auth/cloud-identity.policies.readonly`

### 3. Set Environment Variable

Ensure `WORKSPACE_DOMAIN` is set in your environment (or it will be extracted from user email).

## Usage (app UI)

1. Open **Security audit** in the sidebar (**`/audit`**).
2. Click **Run audit** to (re)evaluate all checks; the bar shows the **last run** time. The audit runs once automatically on first open.
3. Use the segment control: **Overview**, **Passing**, **Failing**, **Ignored**. The **Failing** tab lists actionable items (warning/fail/manual); `info` items stay on the Overview only. Waived checks are excluded from the compliance score until tracked again.
4. **Waive** a check to exclude it from the score. You'll be prompted for an optional **reason** (e.g. "delegation required for shared inbox"), stored locally and shown on the Ignored tab and in the PDF export. Use the pencil to edit the reason or the undo arrow to track it again.
5. Browse checks grouped by category on the Overview and list tabs.
6. **Configure** opens the Admin Console for a check when a URL is available.
7. **Export** supports **CSV**, **Google Drive**, and **PDF** (see the Export menu on wide layouts).

## Limitations

- Some settings require manual verification (marked as "manual" status)
- DNS checks require network access to DNS servers
- Chrome Policy API requires proper permissions and API enablement
- Some Enterprise-only features (DLP, Context-Aware Access) may not be accessible

## Cost

- DNS checks: Free (uses Node.js DNS module)
- Chrome Policy API: Free (within Google API quotas)
- No additional infrastructure required
