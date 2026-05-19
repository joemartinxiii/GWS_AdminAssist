import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import { getSecret } from './gcp.config';

let serviceAccountClient: JWT | null = null;
let oauth2Client: any = null;

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
    const secretJson = await getSecret('service-account-key');
    const credentials = JSON.parse(secretJson);
    
    serviceAccountClient = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [
        'https://www.googleapis.com/auth/admin.directory.user',
        'https://www.googleapis.com/auth/admin.directory.group',
        // Needed for listing org units in Directory API.
        'https://www.googleapis.com/auth/admin.directory.orgunit.readonly',
        // Needed for reading OAuth token/app grants (third-party apps panel).
        'https://www.googleapis.com/auth/admin.directory.user.security',
        'https://www.googleapis.com/auth/apps.security',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/gmail.settings.basic',
        // Required for delegation APIs (users.settings.delegates.*)
        'https://www.googleapis.com/auth/gmail.settings.sharing',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/chrome.management.policy',
      ],
      subject: undefined, // Will be set per-request for domain-wide delegation
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
