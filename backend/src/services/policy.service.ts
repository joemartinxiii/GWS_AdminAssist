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

      do {
        const url = new URL(POLICIES_ENDPOINT);
        url.searchParams.set('pageSize', '100');
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const resp = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          throw new Error(`Policy API ${resp.status}: ${body.slice(0, 300)}`);
        }

        const data = (await resp.json()) as {
          policies?: RawPolicy[];
          nextPageToken?: string;
        };
        if (Array.isArray(data.policies)) policies.push(...data.policies);
        pageToken = data.nextPageToken;
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
