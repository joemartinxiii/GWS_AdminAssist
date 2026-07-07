/**
 * Normalize an email path parameter.
 *
 * Accepts either a bare email address or a "Display Name (user@domain)" form
 * and returns the extracted address, or an empty string if none is found.
 * Centralized here to avoid the copies previously duplicated across the
 * users, groups, and gmail route modules.
 */
export function normalizeEmailParam(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return trimmed;
  const inParens = trimmed.match(/\(([^\s@]+@[^\s@]+\.[^\s@]+)\)\s*$/)?.[1];
  return inParens || '';
}
