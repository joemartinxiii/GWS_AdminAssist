import { WorkspaceService } from './workspace.service';

export interface User {
  id: string;
  primaryEmail: string;
  name: {
    givenName: string;
    familyName: string;
    fullName: string;
  };
  isAdmin: boolean;
  /** True when the user has delegated admin privileges (not super admin). */
  isDelegatedAdmin?: boolean;
  /** Privilege IDs from Directory API (e.g. MANAGE_USERS). */
  delegatedAdminPrivileges?: string[];
  suspended: boolean;
  orgUnitPath: string;
  creationTime: string;
  lastLoginTime?: string;
  isEnforcedIn2Sv?: boolean;
  isEnrolledIn2Sv?: boolean;
  department?: string;
  location?: string;
  phone?: string;
  notes?: string;
}

export interface ThirdPartyApp {
  clientId: string;
  displayText: string;
  anonymous: boolean;
  scopes: string[];
  nativeApp: boolean;
}

/** Department lives on Directory API `organizations[]`, not `orgUnitPath`. */
function departmentFromGoogleUser(user: {
  organizations?: Array<{ primary?: boolean; department?: string }>;
}): string {
  const orgs = user?.organizations;
  if (!Array.isArray(orgs) || orgs.length === 0) return '';
  const primary = orgs.find((o) => o.primary) || orgs[0];
  return primary?.department || '';
}

export class UserService extends WorkspaceService {
  /**
   * List all users in the domain
   */
  async listUsers(userEmail: string, maxResults: number = 500): Promise<User[]> {
    const admin = await this.adminFor(userEmail);

    const users: User[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.withRetry(() =>
        admin.users.list({
          domain: process.env.WORKSPACE_DOMAIN,
          maxResults: Math.min(maxResults, 500),
          pageToken,
          projection: 'full',
        })
      );

      if (response.data.users) {
        for (const user of response.data.users) {
          users.push({
            id: user.id || '',
            primaryEmail: user.primaryEmail || '',
            name: {
              givenName: user.name?.givenName || '',
              familyName: user.name?.familyName || '',
              fullName: user.name?.fullName || '',
            },
            isAdmin: user.isAdmin === true,
            isDelegatedAdmin: user.isDelegatedAdmin === true,
            delegatedAdminPrivileges: Array.isArray(user.delegatedAdminPrivileges)
              ? (user.delegatedAdminPrivileges as string[])
              : [],
            suspended: user.suspended === true,
            orgUnitPath: user.orgUnitPath || '/',
            creationTime: user.creationTime || '',
            lastLoginTime: user.lastLoginTime,
            isEnforcedIn2Sv: user.isEnforcedIn2Sv === true,
            isEnrolledIn2Sv: user.isEnrolledIn2Sv === true,
            department: departmentFromGoogleUser(user),
            location: user.locations?.[0]?.area || user.locations?.[0]?.buildingId || '',
            phone: user.phones?.[0]?.value || '',
            notes: user.notes?.value || user.notes?.content || '',
          });
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken && users.length < maxResults);

    return users;
  }

  /**
   * Get user by email
   */
  async getUser(userEmail: string, targetEmail: string): Promise<User | null> {
    const admin = await this.adminFor(userEmail);

    try {
      const response = await this.withRetry(() =>
        admin.users.get({
          userKey: targetEmail,
          projection: 'full',
        })
      );

      const user = response.data;
      if (!user) return null;

      return {
        id: user.id || '',
        primaryEmail: user.primaryEmail || '',
        name: {
          givenName: user.name?.givenName || '',
          familyName: user.name?.familyName || '',
          fullName: user.name?.fullName || '',
        },
        isAdmin: user.isAdmin === true,
        isDelegatedAdmin: user.isDelegatedAdmin === true,
        delegatedAdminPrivileges: Array.isArray(user.delegatedAdminPrivileges)
          ? (user.delegatedAdminPrivileges as string[])
          : [],
        suspended: user.suspended === true,
        orgUnitPath: user.orgUnitPath || '/',
        creationTime: user.creationTime || '',
        lastLoginTime: user.lastLoginTime,
        isEnforcedIn2Sv: user.isEnforcedIn2Sv === true,
        isEnrolledIn2Sv: user.isEnrolledIn2Sv === true,
        department: departmentFromGoogleUser(user),
        location: user.locations?.[0]?.area || user.locations?.[0]?.buildingId || '',
        phone: user.phones?.[0]?.value || '',
        notes: user.notes?.value || user.notes?.content || '',
      };
    } catch (error: any) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create a new user
   */
  async createUser(
    userEmail: string,
    userData: {
      primaryEmail: string;
      password: string;
      givenName: string;
      familyName: string;
    }
  ): Promise<User> {
    const admin = await this.adminFor(userEmail);

    const response = await this.withRetry(() =>
      admin.users.insert({
        requestBody: {
          primaryEmail: userData.primaryEmail,
          password: userData.password,
          name: {
            givenName: userData.givenName,
            familyName: userData.familyName,
          },
        },
      })
    );

    const user = response.data;
    return {
      id: user.id || '',
      primaryEmail: user.primaryEmail || '',
      name: {
        givenName: user.name?.givenName || '',
        familyName: user.name?.familyName || '',
        fullName: user.name?.fullName || '',
      },
      isAdmin: user.isAdmin === true,
      isDelegatedAdmin: user.isDelegatedAdmin === true,
      delegatedAdminPrivileges: Array.isArray(user.delegatedAdminPrivileges)
        ? (user.delegatedAdminPrivileges as string[])
        : [],
      suspended: user.suspended === true,
      orgUnitPath: user.orgUnitPath || '/',
      creationTime: user.creationTime || '',
      isEnforcedIn2Sv: user.isEnforcedIn2Sv === true,
      isEnrolledIn2Sv: user.isEnrolledIn2Sv === true,
    };
  }

  /**
   * Update user
   */
  async updateUser(
    userEmail: string,
    targetEmail: string,
    updates: Partial<{
      givenName: string;
      familyName: string;
      suspended: boolean;
      orgUnitPath: string;
      department: string;
      location: string;
      phone: string;
      notes: string;
    }>
  ): Promise<User> {
    const admin = await this.adminFor(userEmail);

    const requestBody: any = {};
    if (updates.givenName || updates.familyName) {
      requestBody.name = {};
      if (updates.givenName) requestBody.name.givenName = updates.givenName;
      if (updates.familyName) requestBody.name.familyName = updates.familyName;
    }
    if (updates.suspended !== undefined) requestBody.suspended = updates.suspended;
    if (updates.orgUnitPath) requestBody.orgUnitPath = updates.orgUnitPath;
    if (updates.department !== undefined) {
      const cur = await this.withRetry(() =>
        admin.users.get({
          userKey: targetEmail,
          projection: 'full',
        })
      );
      const raw = cur.data?.organizations;
      const orgs: Array<Record<string, unknown>> = Array.isArray(raw) ? raw.map((o) => ({ ...(o as object) })) : [];
      const primaryIdx = orgs.findIndex((o: any) => o.primary);
      if (primaryIdx >= 0) {
        orgs[primaryIdx] = { ...orgs[primaryIdx], department: updates.department, primary: true };
        requestBody.organizations = orgs;
      } else if (updates.department) {
        orgs.push({ department: updates.department, primary: true });
        requestBody.organizations = orgs;
      } else if (orgs.length > 0) {
        orgs[0] = { ...orgs[0], department: '' };
        requestBody.organizations = orgs;
      }
    }
    if (updates.location) {
      requestBody.locations = [{ area: updates.location }];
    }
    if (updates.phone) {
      requestBody.phones = [{ value: updates.phone, type: 'work' }];
    }
    if (updates.notes !== undefined) {
      requestBody.notes = { value: updates.notes, contentType: 'text_plain' };
    }

    const response = await this.withRetry(() =>
      admin.users.update({
        userKey: targetEmail,
        requestBody,
      })
    );

    const user = response.data;
    return {
      id: user.id || '',
      primaryEmail: user.primaryEmail || '',
      name: {
        givenName: user.name?.givenName || '',
        familyName: user.name?.familyName || '',
        fullName: user.name?.fullName || '',
      },
      isAdmin: user.isAdmin === true,
      isDelegatedAdmin: user.isDelegatedAdmin === true,
      delegatedAdminPrivileges: Array.isArray(user.delegatedAdminPrivileges)
        ? (user.delegatedAdminPrivileges as string[])
        : [],
      suspended: user.suspended === true,
      orgUnitPath: user.orgUnitPath || '/',
      creationTime: user.creationTime || '',
      lastLoginTime: user.lastLoginTime,
      isEnforcedIn2Sv: user.isEnforcedIn2Sv === true,
      isEnrolledIn2Sv: user.isEnrolledIn2Sv === true,
      department: departmentFromGoogleUser(user),
      location: user.locations?.[0]?.area || '',
      phone: user.phones?.[0]?.value || '',
      notes: user.notes?.value || user.notes?.content || '',
    };
  }

  /**
   * Get third-party apps (OAuth tokens) for a user
   */
  async getThirdPartyApps(userEmail: string, targetEmail: string): Promise<ThirdPartyApp[]> {
    const admin = await this.adminFor(userEmail);

    try {
      const response = await this.withRetry(() =>
        admin.tokens.list({
          userKey: targetEmail,
        })
      );

      if (!response.data.items) {
        return [];
      }

      return response.data.items.map((token: any) => ({
        clientId: token.clientId || '',
        displayText: token.displayText || token.clientId || 'Unknown App',
        anonymous: token.anonymous === true,
        scopes: token.scopes || [],
        nativeApp: token.nativeApp === true,
      }));
    } catch (error: any) {
      if (error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Revoke a third-party app (OAuth token) for a user
   */
  async revokeThirdPartyApp(userEmail: string, targetEmail: string, clientId: string): Promise<void> {
    const admin = await this.adminFor(userEmail);
    await this.withRetry(() =>
      admin.tokens.delete({
        userKey: targetEmail,
        clientId,
      })
    );
  }

  /**
   * Revoke all third-party apps (OAuth tokens) for a user
   */
  async revokeAllThirdPartyApps(userEmail: string, targetEmail: string): Promise<number> {
    const admin = await this.adminFor(userEmail);

    const apps = await this.getThirdPartyApps(userEmail, targetEmail);
    let revokedCount = 0;

    for (const app of apps) {
      try {
        await this.revokeThirdPartyApp(userEmail, targetEmail, app.clientId);
        revokedCount++;
      } catch (error) {
        console.error(`Failed to revoke app ${app.clientId}:`, error);
      }
    }

    return revokedCount;
  }

  /**
   * Delete user
   */
  async deleteUser(userEmail: string, targetEmail: string): Promise<void> {
    const admin = await this.adminFor(userEmail);
    await this.withRetry(() =>
      admin.users.delete({
        userKey: targetEmail,
      })
    );
  }

  /**
   * Search users
   */
  async searchUsers(userEmail: string, query: string): Promise<User[]> {
    const admin = await this.adminFor(userEmail);

    const response = await this.withRetry(() =>
      admin.users.list({
        domain: process.env.WORKSPACE_DOMAIN,
        query: query,
        maxResults: 100,
        projection: 'full',
      })
    );

    const users: User[] = [];
    if (response.data.users) {
      for (const user of response.data.users) {
        users.push({
          id: user.id || '',
          primaryEmail: user.primaryEmail || '',
          name: {
            givenName: user.name?.givenName || '',
            familyName: user.name?.familyName || '',
            fullName: user.name?.fullName || '',
          },
          isAdmin: user.isAdmin === true,
          isDelegatedAdmin: user.isDelegatedAdmin === true,
          delegatedAdminPrivileges: Array.isArray(user.delegatedAdminPrivileges)
            ? (user.delegatedAdminPrivileges as string[])
            : [],
          suspended: user.suspended === true,
          orgUnitPath: user.orgUnitPath || '/',
          creationTime: user.creationTime || '',
          lastLoginTime: user.lastLoginTime,
          isEnforcedIn2Sv: user.isEnforcedIn2Sv === true,
          isEnrolledIn2Sv: user.isEnrolledIn2Sv === true,
        });
      }
    }

    return users;
  }

  /**
   * List all organizational units in the domain
   */
  async listOrganizationalUnits(userEmail: string): Promise<Array<{ orgUnitPath: string; name: string }>> {
    const admin = await this.adminFor(userEmail);

    const orgUnits: Array<{ orgUnitPath: string; name: string }> = [];
    
    // Get the domain name for the root OU
    const domain = process.env.WORKSPACE_DOMAIN || 'example.com';
    
    // Always include the root OU with domain name
    orgUnits.push({ orgUnitPath: '/', name: domain });

    try {
      const response = await this.withRetry(() =>
        admin.orgunits.list({
          customerId: 'my_customer',
          type: 'all',
        })
      );

      if (response.data.organizationUnits) {
        for (const ou of response.data.organizationUnits) {
          if (ou.orgUnitPath && ou.name) {
            orgUnits.push({
              orgUnitPath: ou.orgUnitPath,
              name: ou.name,
            });
          }
        }
      }
    } catch (error: any) {
      console.error('Error listing organizational units:', error);
      // Return at least the root OU even if there's an error
    }

    // Sort alphabetically by name, but keep root (/) first
    const rootOU = orgUnits.find(ou => ou.orgUnitPath === '/');
    const otherOUs = orgUnits.filter(ou => ou.orgUnitPath !== '/');
    
    // Sort other OUs alphabetically by name
    otherOUs.sort((a, b) => a.name.localeCompare(b.name));
    
    // Return root first, then sorted others
    return rootOU ? [rootOU, ...otherOUs] : otherOUs;
  }
}

export const userService = new UserService();
