/**
 * Generates a standardized export filename in the format:
 * {sanitized-domain}-{page}-{date}.{extension}
 * Example: acme.com-users-all-2026-04-10.csv
 * Uses WORKSPACE_DOMAIN (or override), descriptive page name, and YYYY-MM-DD date.
 */
export function generateExportFilename(
  page: string,
  domainOverride?: string,
  extension: string = 'csv'
): string {
  const rawDomain = domainOverride || process.env.WORKSPACE_DOMAIN || 'workspace';
  const domain = rawDomain
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/-+/g, '-'); // Collapse multiple hyphens

  const now = new Date();
  const timestamp = now.toISOString().split('T')[0];

  return `${domain}-${page}-${timestamp}.${extension}`;
}

/**
 * Converts array of objects to CSV string with proper escaping.
 * Centralized to avoid duplication across routes (users, drive, groups, etc.).
 * Supports basic transformation and header mapping.
 */
export interface CSVOptions {
  headers?: Record<string, string>;
  transform?: (row: any) => Record<string, any>;
}

export function convertToCSV(data: any[], options: CSVOptions = {}): string {
  if (!data || data.length === 0) return '';

  const { headers = {}, transform } = options;

  // Use first row to determine headers if not provided
  let headersToUse = Object.keys(data[0] || {});
  if (Object.keys(headers).length > 0) {
    headersToUse = Object.keys(headers);
  }

  const csvRows: string[] = [headersToUse.map(h => headers[h] || h).join(',')];

  for (const row of data) {
    const processedRow = transform ? transform(row) : row;
    const values = headersToUse.map(header => {
      let value = processedRow[header];
      if (value === null || value === undefined) {
        return '';
      }
      if (Array.isArray(value)) {
        value = value.join('; ');
      }
      const stringValue = String(value)
        .replace(/"/g, '""')  // Escape quotes
        .replace(/\n/g, ' '); // Normalize newlines
      return stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') 
        ? `"${stringValue}"` 
        : stringValue;
    });
    csvRows.push(values.join(','));
  }

  return csvRows.join('\n');
}

/**
 * Helper to send CSV response with proper headers.
 * Use in export routes to ensure consistency and security (no sensitive headers leaked).
 */
export function sendCSVResponse(
  res: any, 
  csvData: string, 
  filename: string = 'export.csv',
  auditLogFn?: () => void
): void {
  if (auditLogFn) auditLogFn();
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // Security: prevent caching of sensitive exports
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(csvData);
}
