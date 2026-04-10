# Audit Logging System

## Overview

The backend logs **mutations** (create, update, delete) from authenticated users to **Google Cloud Logging** for compliance and accountability. In practice only **Workspace super admins** can perform mutations in this app; read-only requests are not logged as audit events.

## Features

- **Automatic Logging**: All mutation operations (POST, PATCH, DELETE) are automatically logged
- **Immutable Logs**: Logs are stored in Cloud Logging (append-only, tamper-resistant)
- **Structured Data**: Logs include who, what, when, where, and result
- **CSV Export**: Download audit logs as CSV for compliance reporting
- **Cost-Effective**: Uses Cloud Logging free tier (50GB/month)

## What Gets Logged

### Logged Actions

All mutation operations are logged with the following information:

- **User Information**: Email, name
- **Action**: What was done (e.g., "user.create", "drive.permission.update")
- **Resource**: Type and ID of the resource affected
- **Timestamp**: When the action occurred
- **IP Address**: Where the request came from
- **User Agent**: Browser/client information
- **Success/Failure**: Whether the operation succeeded
- **Error Messages**: If the operation failed
- **Changes**: Before/after state (when available)

### Actions Logged

- **Users**: update (user profiles), delete (third-party apps), export operations
- **Drive**: permission create, update, delete, bulk external share removal
- **Gmail**: delegation create/delete, send-as create/update/delete, signature templates
- **Calendar**: resource create, update, delete
- **Groups**: create, update, delete, member add/update/remove
- **Audit**: security exports, hardening checks

### Not Logged

- **Read Operations**: GET requests are not logged (only mutations)
- **Query Operations**: Search, list, and view operations are not logged

## Cloud Logging Configuration

### Log Name
- **Log Name**: `workspace-admin-audit`
- **Resource Type**: `global`
- **Retention**: 30 days (default Cloud Logging retention)

### Log Structure

Each log entry contains:
```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "userId": "admin@domain.com",
  "userEmail": "admin@domain.com",
  "userName": "Admin User",
  "action": "user.create",
  "resourceType": "user",
  "resourceId": "newuser@domain.com",
  "resourceName": "New User",
  "ipAddress": "192.168.1.1",
  "userAgent": "Mozilla/5.0...",
  "success": true,
  "errorMessage": null,
  "changes": {
    "after": { ... }
  }
}
```

## Accessing Audit Logs

### Via GCP Console

1. Go to Cloud Logging in GCP Console
2. Use Logs Explorer
3. Filter by log name: `workspace-admin-audit`
4. Query using filters:
   - `jsonPayload.userEmail="admin@domain.com"`
   - `jsonPayload.action="user.create"`
   - `jsonPayload.resourceType="user"`
   - `timestamp>="2024-01-01T00:00:00Z"`

### Via API (CSV Export)

**Endpoint**: `GET /api/audit/logs/export`

**Query Parameters**:
- `startDate` (optional): Start date (ISO format, default: 30 days ago)
- `endDate` (optional): End date (ISO format, default: now)
- `userId` (optional): Filter by user email
- `action` (optional): Filter by action (e.g., "user.create")
- `resourceType` (optional): Filter by resource type (e.g., "user", "drive")

**Example**:
```
GET /api/audit/logs/export?startDate=2024-01-01&userId=admin@domain.com&action=user.create
```

**Response**: CSV file download

## Cost

- **Free Tier**: 50GB/month of log ingestion
- **Retention**: 30 days (free)
- **Estimated Cost**: $0/month for typical admin tool usage

## Local Development

In local development (when `GCP_PROJECT_ID` is not set), audit logs are:
- Printed to console as JSON
- Not sent to Cloud Logging
- Still structured the same way for testing

## Compliance

The audit logging system provides:
- **Immutable Logs**: Cloud Logging logs are append-only
- **Tamper-Resistant**: Cannot be modified after creation
- **Retention**: 30 days standard retention (meets most compliance requirements)
- **Access Control**: Only GWS admins can access logs (via authentication)
- **Audit Trail**: Complete record of who did what and when

## Example Queries

### Find all user creations in the last week
```
resource.type="global" AND
logName="projects/YOUR_PROJECT_ID/logs/workspace-admin-audit" AND
jsonPayload.action="user.create" AND
timestamp>="2024-01-08T00:00:00Z"
```

### Find all failed operations
```
resource.type="global" AND
logName="projects/YOUR_PROJECT_ID/logs/workspace-admin-audit" AND
severity="ERROR"
```

### Find all actions by a specific admin
```
resource.type="global" AND
logName="projects/YOUR_PROJECT_ID/logs/workspace-admin-audit" AND
jsonPayload.userEmail="admin@domain.com"
```

## Security Notes

- Logs contain sensitive information (user emails, resource IDs)
- Access to logs is controlled by authentication middleware
- Only authenticated admins can export logs
- Logs are stored in GCP and subject to GCP security policies
- No encryption needed as only GWS admins have access
