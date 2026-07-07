import { Response } from 'express';

/**
 * Normalized representation of an error surfaced to the API client.
 *
 * Google APIs (googleapis / gaxios) expose the real HTTP status in a variety of
 * places depending on the failure mode (`error.code`, `error.response.status`,
 * `error.status`, nested `error.errors[]`). Relying on `error.status` alone —
 * as the route handlers historically did — silently collapses genuine 403/404
 * responses into opaque 500s. This module resolves the true status and a
 * meaningful, actionable message from any of those shapes.
 */
export interface NormalizedApiError {
  status: number;
  message: string;
  code?: string;
  hint?: string;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

function resolveStatus(error: any): number {
  const candidates = [
    error?.response?.status,
    typeof error?.code === 'number' ? error.code : undefined,
    error?.status,
    error?.statusCode,
    error?.response?.data?.error?.code,
  ];
  for (const c of candidates) {
    const n = typeof c === 'string' ? parseInt(c, 10) : c;
    if (typeof n === 'number' && n >= 400 && n <= 599) return n;
  }
  return 500;
}

function hintForStatus(status: number, reason?: string): string | undefined {
  switch (status) {
    case 401:
      return 'Authentication failed. The service account credentials or the signed-in session may be invalid or expired.';
    case 403:
      if (reason === 'domainPolicy' || reason === 'sharingRateLimitExceeded') {
        return 'Google denied the request due to a domain policy. Check Workspace admin sharing/policy settings for this operation.';
      }
      return 'Access denied by Google. Verify domain-wide delegation is configured with the required scopes (see SECURITY.md / `npm run check:scopes`) and that the signed-in user has the necessary Workspace admin privileges.';
    case 404:
      return 'The requested Google Workspace resource was not found. It may have been deleted or the identifier is incorrect.';
    case 429:
      return 'Google API rate limit exceeded. Please retry after a short delay.';
    default:
      return undefined;
  }
}

/**
 * Extract a normalized `{ status, message, code, hint }` from any thrown error.
 */
export function normalizeApiError(error: any): NormalizedApiError {
  const status = resolveStatus(error);

  const googleReason: string | undefined =
    error?.response?.data?.error?.errors?.[0]?.reason ?? error?.errors?.[0]?.reason;

  const message =
    firstString(
      error?.response?.data?.error?.message,
      error?.response?.data?.error_description,
      error?.errors?.[0]?.message,
      error?.message
    ) ?? 'An unexpected error occurred';

  const code = firstString(
    error?.response?.data?.error?.status,
    typeof error?.code === 'string' ? error.code : undefined,
    googleReason
  );

  return { status, message, code, hint: hintForStatus(status, googleReason) };
}

/**
 * Log an error and send a normalized JSON error response.
 *
 * - 4xx messages (which describe the caller's own tenant/request and are safe
 *   and useful for an admin tool) are passed through, along with an actionable
 *   hint when available.
 * - 5xx messages are replaced with a generic message in production to avoid
 *   leaking internal details, while still being logged server-side.
 */
export function sendApiError(
  res: Response,
  error: any,
  fallbackMessage = 'An unexpected error occurred',
  logLabel = 'api'
): void {
  const normalized = normalizeApiError(error);
  const isProduction = process.env.NODE_ENV === 'production';

  console.error(`[${logLabel}]`, {
    status: normalized.status,
    code: normalized.code,
    message: normalized.message,
    ...(isProduction ? {} : { stack: error?.stack }),
  });

  const isServerError = normalized.status >= 500;
  const clientMessage =
    isServerError && isProduction ? fallbackMessage : normalized.message || fallbackMessage;

  res.status(normalized.status).json({
    error: clientMessage,
    ...(normalized.code ? { code: normalized.code } : {}),
    ...(normalized.hint ? { hint: normalized.hint } : {}),
  });
}
