import { getDelegatedAccessToken } from '../config/google.config';

/**
 * Thin wrapper around the Cloud Identity Policy API (`policies.list`).
 *
 * We call the REST endpoint directly with a delegated bearer token instead of
 * going through the googleapis client: the pinned googleapis release predates
 * the `cloudidentity.policies` resource, and a raw fetch keeps us independent
 * of client-library churn while giving us the untyped setting `value` object
 * as-is.
 *
 * The Policy API requires a **super administrator** subject and the
 * `cloud-identity.policies.readonly` scope, with `cloudidentity.googleapis.com`
 * enabled. When any of those are missing the load fails and callers fall back
 * to treating the affected checks as "manual".
 */

const POLICIES_ENDPOINT = 'https://cloudidentity.googleapis.com/v1/policies';

/** Prefer fewer pages — Cloud Identity accepts up to this many per list call. */
const PAGE_SIZE = 1000;
/** Brief pause between pages to avoid burst rate limits on large tenants. */
const INTER_PAGE_DELAY_MS = 150;
/** Retries for transient 429 / 5xx (exponential backoff + Retry-After). */
const MAX_FETCH_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 800;

interface RawPolicyQuery {
  query?: string;
  orgUnit?: string;
  group?: string;
  sortOrder?: number;
}

interface RawPolicy {
  name?: string;
  policyQuery?: RawPolicyQuery;
  setting?: { type?: string; value?: Record<string, unknown> };
  type?: string; // 'ADMIN' | 'SYSTEM'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch one policies.list page with retries on 429 / 5xx.
 * WorkspaceService.withRetry covers googleapis clients; this path uses raw fetch.
 */
async function fetchPoliciesPage(
  url: string,
  token: string
): Promise<{ policies: RawPolicy[]; nextPageToken?: string }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (resp.ok) {
        const data = (await resp.json()) as {
          policies?: RawPolicy[];
          nextPageToken?: string;
        };
        return {
          policies: Array.isArray(data.policies) ? data.policies : [],
          nextPageToken: data.nextPageToken,
        };
      }

      const body = await resp.text().catch(() => '');
      const retryable = resp.status === 429 || resp.status >= 500;

      if (retryable && attempt < MAX_FETCH_ATTEMPTS - 1) {
        const retryAfterHdr = resp.headers.get('retry-after');
        let waitMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
        if (retryAfterHdr) {
          const asInt = parseInt(retryAfterHdr, 10);
          if (!Number.isNaN(asInt) && asInt > 0) {
            // Header may be seconds or an HTTP-date; prefer seconds when numeric.
            waitMs = asInt < 1000 ? asInt * 1000 : asInt;
          }
        }
        // Cap single wait so Cloud Run request doesn't hang forever.
        waitMs = Math.min(waitMs, 15_000);
        console.warn(
          `Cloud Identity Policy API HTTP ${resp.status} (attempt ${attempt + 1}/${MAX_FETCH_ATTEMPTS}); retrying in ${waitMs}ms`
        );
        await sleep(waitMs);
        continue;
      }

      console.error(
        `Cloud Identity Policy API HTTP ${resp.status}:`,
        body.slice(0, 500)
      );
      throw new Error(`Policy API HTTP ${resp.status}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Policy API HTTP')) {
        throw error;
      }
      // Network blip — retry
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_FETCH_ATTEMPTS - 1) {
        const waitMs = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), 15_000);
        console.warn(
          `Cloud Identity Policy API network error (attempt ${attempt + 1}/${MAX_FETCH_ATTEMPTS}): ${lastError.message}; retrying in ${waitMs}ms`
        );
        await sleep(waitMs);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || new Error('Policy API request failed after retries');
}

export interface PolicyLookup {
  /** True when a policy for the requested setting type was returned. */
  found: boolean;
  /** The setting value object (camelCase fields), or null when not found. */
  value: Record<string, unknown> | null;
  /**
   * Number of distinct organization-unit-scoped policies found for this type.
   * When > 1 the setting is overridden per-OU and the returned value reflects
   * only one scope — callers should surface that ambiguity.
   */
  scopeCount: number;
}

/** Strip the leading `settings/` from a setting type identifier. */
function normalizeType(type?: string): string {
  if (!type) return '';
  return type.startsWith('settings/') ? type.slice('settings/'.length) : type;
}

/**
 * An immutable, in-memory view of a customer's admin policies indexed by
 * setting type. Built once per audit run.
 */
export class PolicySnapshot {
  readonly available: boolean;
  readonly error?: string;
  private readonly byType = new Map<string, RawPolicy[]>();

  constructor(policies: RawPolicy[], available: boolean, error?: string) {
    this.available = available;
    this.error = error;
    for (const p of policies) {
      const key = normalizeType(p.setting?.type);
      if (!key) continue;
      const list = this.byType.get(key) ?? [];
      list.push(p);
      this.byType.set(key, list);
    }
  }

  /**
   * Resolve the effective org-level value for a setting type. Prefers
   * admin-configured, non-group (organization-unit) policies so we describe the
   * organization's posture rather than a single group override.
   */
  get(settingType: string): PolicyLookup {
    const list = this.byType.get(settingType) ?? [];
    if (list.length === 0) {
      return { found: false, value: null, scopeCount: 0 };
    }

    const ouScoped = list.filter((p) => !p.policyQuery?.group);
    const candidates = ouScoped.length > 0 ? ouScoped : list;

    // Prefer admin-set policies over Google system defaults when both appear.
    const admin = candidates.filter((p) => p.type === 'ADMIN');
    const chosenPool = admin.length > 0 ? admin : candidates;
    const primary = chosenPool[0];

    return {
      found: true,
      value: primary.setting?.value ?? {},
      scopeCount: ouScoped.length,
    };
  }

  /** All policies matching a setting type (e.g. for rule.dlp counts). */
  all(settingType: string): RawPolicy[] {
    return this.byType.get(settingType) ?? [];
  }
}

export class PolicyService {
  /**
   * Fetch every admin policy for the customer of `subject` (a super admin).
   * Never throws: on failure it returns an unavailable snapshot so the audit
   * can degrade to manual checks.
   */
  async loadOrgPolicies(subject: string): Promise<PolicySnapshot> {
    try {
      const token = await getDelegatedAccessToken(subject);
      const policies: RawPolicy[] = [];
      let pageToken: string | undefined;
      let pageIndex = 0;

      do {
        if (pageIndex > 0 && INTER_PAGE_DELAY_MS > 0) {
          await sleep(INTER_PAGE_DELAY_MS);
        }

        const url = new URL(POLICIES_ENDPOINT);
        url.searchParams.set('pageSize', String(PAGE_SIZE));
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const page = await fetchPoliciesPage(url.toString(), token);
        policies.push(...page.policies);
        pageToken = page.nextPageToken;
        pageIndex += 1;
      } while (pageToken);

      return new PolicySnapshot(policies, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new PolicySnapshot([], false, message);
    }
  }
}

export const policyService = new PolicyService();

// --- Value helpers ----------------------------------------------------------

/**
 * Read a field from a setting value, tolerating both camelCase (what the JSON
 * API returns) and snake_case (as documented) spellings.
 */
export function readField(
  value: Record<string, unknown> | null | undefined,
  ...names: string[]
): unknown {
  if (!value) return undefined;
  for (const name of names) {
    if (name in value) return value[name];
    const snake = name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
    if (snake in value) return value[snake];
    const camel = name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (camel in value) return value[camel];
  }
  return undefined;
}

export function readBool(
  value: Record<string, unknown> | null | undefined,
  ...names: string[]
): boolean | undefined {
  const v = readField(value, ...names);
  return typeof v === 'boolean' ? v : undefined;
}

export function readString(
  value: Record<string, unknown> | null | undefined,
  ...names: string[]
): string | undefined {
  const v = readField(value, ...names);
  return typeof v === 'string' ? v : undefined;
}
