import { readFileSync } from 'fs';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { getSecret } from './gcp.config';

let serviceAccountClient: JWT | null = null;
let oauth2Client: any = null;

const SERVICE_ACCOUNT_SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user',
  'https://www.googleapis.com/auth/admin.directory.group',
  'https://www.googleapis.com/auth/admin.directory.orgunit.readonly',
  'https://www.googleapis.com/auth/admin.directory.user.security',
  'https://www.googleapis.com/auth/apps.security',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/admin.directory.resource.calendar',
  'https://www.googleapis.com/auth/chrome.management.policy',
];

async function loadServiceAccountCredentials(): Promise<{ client_email: string; private_key: string }> {
  if (process.env.SA_KEY_PATH) {
    const raw = readFileSync(process.env.SA_KEY_PATH, 'utf8');
    return JSON.parse(raw);
  }
  const secretJson = await getSecret(process.env.SERVICE_ACCOUNT_SECRET_NAME || 'service-account-key');
  return JSON.parse(secretJson);
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  workspaceDomain: string;
}

export function getGoogleConfig(): GoogleConfig {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || '',
    workspaceDomain: process.env.WORKSPACE_DOMAIN || '',
  };
}

export async function getServiceAccountClient(): Promise<JWT> {
  if (serviceAccountClient) {
    return serviceAccountClient;
  }

  try {
    const credentials = await loadServiceAccountCredentials();

    serviceAccountClient = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: SERVICE_ACCOUNT_SCOPES,
      subject: undefined,
    });

    return serviceAccountClient;
  } catch (error) {
    console.error('Error initializing service account client:', error);
    throw error;
  }
}

export function getOAuth2Client() {
  if (oauth2Client) {
    return oauth2Client;
  }

  const config = getGoogleConfig();
  oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );

  return oauth2Client;
}

export function getAuthUrl(): string {
  const client = getOAuth2Client();
  const config = getGoogleConfig();
  
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
      'https://www.googleapis.com/auth/admin.directory.group.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
    prompt: 'consent',
  });
}

export async function getTokensFromCode(code: string) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  return tokens;
}
