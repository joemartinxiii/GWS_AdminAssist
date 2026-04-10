/**
 * Generates a standardized export filename in the format:
 * {sanitized-domain}-{page}-{date}.{extension}
 * Matches the backend generator for consistency (date-only as requested).
 * Uses VITE_WORKSPACE_DOMAIN from env (add to .env.local: VITE_WORKSPACE_DOMAIN=yourdomain.com).
 */
export function generateExportFilename(
  page: string,
  domainOverride?: string,
  extension: string = 'csv'
): string {
  const rawDomain = domainOverride || (import.meta.env.VITE_WORKSPACE_DOMAIN as string) || 'workspace';
  const domain = rawDomain
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/-+/g, '-');

  const now = new Date();
  const timestamp = now.toISOString().split('T')[0];

  return `${domain}-${page}-${timestamp}.${extension}`;
}
