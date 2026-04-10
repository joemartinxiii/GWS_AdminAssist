# Google Workspace Hardening Implementation

## Overview

The GWS Hardening feature provides automated security checks based on your hardening checklist. It checks various Google Workspace security settings and DNS records to ensure your organization follows security best practices.

## Features

### Automated Checks

1. **Authentication**
   - ✅ 2FA Enforcement (checks user enrollment rate)
   - ⚠️ Password Policy (manual check with link)

2. **Email Security**
   - ✅ SPF Record (DNS check)
   - ✅ DKIM Record (DNS check with key size validation)
   - ✅ DMARC Record (DNS check with policy validation)
   - ⚠️ Email Read Receipts (manual check)
   - ⚠️ Mail Delegation (manual check)
   - ⚠️ Confidential Mode (manual check)
   - ⚠️ Automatic Forwarding (manual check)
   - ⚠️ External Recipient Warnings (manual check)

3. **Google Drive**
   - ⚠️ Link Sharing Settings (manual check)
   - ⚠️ Shared Drive Creation (manual check)
   - ⚠️ Offline Access (manual check)
   - ⚠️ Drive for Desktop (manual check)

4. **Calendar**
   - ⚠️ Calendar Sharing (manual check)
   - ⚠️ External Warning (manual check)

5. **Chrome Managed Browsers**
   - ✅ Browser Updates (Chrome Policy API)
   - ✅ Company-Enforced Extensions (Chrome Policy API)

6. **Data Download**
   - ⚠️ Google Takeout (manual check)
   - ⚠️ Less Secure Apps (manual check)

7. **Apps Control**
   - ⚠️ Context-Aware Access (manual check, Enterprise only)
   - ⚠️ Core Apps (manual check)
   - ⚠️ Additional Apps (manual check)

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
- **manual**: 📋 Requires manual verification in Admin Console

## DNS Checks

The DNS checking service validates:
- **SPF**: Checks for `v=spf1` record and validates hard fail (`-all`)
- **DKIM**: Checks for DKIM record and validates key size (prefers 2048-bit)
- **DMARC**: Checks for `_dmarc` record and validates policy (p=none minimum)

DNS checks use Node.js built-in `dns` module - no external dependencies required.

## Chrome Policy API

The Chrome Policy API integration checks:
- Browser update policies
- Company-enforced extensions

**Requirements:**
- Chrome Policy API must be enabled in GCP Console
- Service account must have `chrome.management.policy` scope (already added)
- Domain-wide delegation must include Chrome Policy scope

## Setup Instructions

### 1. Enable Chrome Policy API

```bash
gcloud services enable chromepolicy.googleapis.com --project=YOUR_PROJECT_ID
```

### 2. Update Domain-Wide Delegation

Add the Chrome Policy scope to your service account's domain-wide delegation:
- Scope: `https://www.googleapis.com/auth/chrome.management.policy`

### 3. Set Environment Variable

Ensure `WORKSPACE_DOMAIN` is set in your environment (or it will be extracted from user email).

## Usage (app UI)

1. Open **Security audit** in the sidebar (**`/audit`**).
2. Use the segment control: **Overview**, **Passing**, **Failing**, **Ignored** (waived checks are excluded from the compliance score until tracked again).
3. Browse checks grouped by category on the Overview and list tabs.
4. **Configure** opens the Admin Console for a check when a URL is available.
5. **Export** supports **CSV**, **Google Drive**, and **PDF** (see the Export menu on wide layouts).

## Limitations

- Some settings require manual verification (marked as "manual" status)
- DNS checks require network access to DNS servers
- Chrome Policy API requires proper permissions and API enablement
- Some Enterprise-only features (DLP, Context-Aware Access) may not be accessible

## Cost

- DNS checks: Free (uses Node.js DNS module)
- Chrome Policy API: Free (within Google API quotas)
- No additional infrastructure required
