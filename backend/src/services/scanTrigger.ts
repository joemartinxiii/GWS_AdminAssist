import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';

/**
 * Triggers the external-sharing scan Cloud Run Job via the Cloud Run Admin API
 * (v2 `jobs.run`), passing per-run env vars as container overrides. The web
 * service's runtime SA needs `roles/run.developer` to execute the job.
 *
 * Env:
 *   SCAN_JOB_NAME  — the Cloud Run Job name (e.g. workspace-admin-scan)
 *   SCAN_REGION    — job region (defaults to the service region if provided)
 *   GOOGLE_CLOUD_PROJECT / GCP_PROJECT — project id (falls back to ADC lookup)
 */

let auth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (!auth) {
    auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  }
  return auth;
}

export function isScanJobConfigured(): boolean {
  return Boolean(process.env.SCAN_JOB_NAME);
}

async function resolveProjectId(): Promise<string> {
  const fromEnv = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || process.env.PROJECT_ID;
  if (fromEnv) return fromEnv;
  const projectId = await getAuth().getProjectId();
  if (!projectId) throw new Error('Could not determine GCP project id. Set GOOGLE_CLOUD_PROJECT.');
  return projectId;
}

export async function triggerScanJob(params: { scanId: string; triggeredBy: string }): Promise<void> {
  const jobName = process.env.SCAN_JOB_NAME;
  const region = process.env.SCAN_REGION || process.env.REGION || 'us-central1';
  if (!jobName) {
    throw new Error(
      'Asynchronous scanning is not configured. Set SCAN_JOB_NAME (and deploy the scan Cloud Run Job).'
    );
  }

  const projectId = await resolveProjectId();
  const run = google.run({ version: 'v2', auth: getAuth() });
  const name = `projects/${projectId}/locations/${region}/jobs/${jobName}`;

  await run.projects.locations.jobs.run({
    name,
    requestBody: {
      overrides: {
        containerOverrides: [
          {
            env: [
              { name: 'SCAN_ID', value: params.scanId },
              { name: 'SCAN_TRIGGERED_BY', value: params.triggeredBy },
            ],
          },
        ],
      },
    },
  });
}
