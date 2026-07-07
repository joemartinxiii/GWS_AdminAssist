import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

export interface GCPConfig {
  projectId: string;
  region: string;
}

export function getGCPConfig(): GCPConfig {
  return {
    projectId: process.env.GCP_PROJECT_ID || '',
    region: process.env.GCP_REGION || 'us-central1',
  };
}

export async function getSecret(secretName: string): Promise<string> {
  const config = getGCPConfig();
  const client = new SecretManagerServiceClient();
  const name = `projects/${config.projectId}/secrets/${secretName}/versions/latest`;
  
  try {
    const [version] = await client.accessSecretVersion({ name });
    const payload = version.payload?.data?.toString();
    if (!payload) {
      throw new Error(`Secret ${secretName} is empty`);
    }
    return payload;
  } catch (error) {
    console.error(`Error accessing secret ${secretName}:`, error);
    throw error;
  }
}
