import { WorkspaceService } from './workspace.service';
import { mapWithConcurrency } from '../utils/concurrency';

export interface Group {
  id: string;
  email: string;
  name: string;
  description?: string;
  adminCreated: boolean;
  directMembersCount?: number;
}

export interface GroupMember {
  id: string;
  email: string;
  role: 'OWNER' | 'MANAGER' | 'MEMBER';
  type: 'USER' | 'GROUP' | 'CUSTOMER' | 'EXTERNAL';
  status: string;
}

export class GroupsService extends WorkspaceService {
  private normalizeMembersCount(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  /**
   * List all groups in the domain
   */
  async listGroups(userEmail: string, maxResults: number = 500): Promise<Group[]> {
    const dir = await this.adminFor(userEmail);

    const groups: Group[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.withRetry(() =>
        dir.groups.list({
          domain: process.env.WORKSPACE_DOMAIN,
          maxResults: Math.min(maxResults, 500),
          pageToken,
        })
      );

      if (response.data.groups) {
        for (const group of response.data.groups) {
          groups.push({
            id: group.id || '',
            email: group.email || '',
            name: group.name || '',
            description: group.description,
            adminCreated: group.adminCreated === true,
            directMembersCount: this.normalizeMembersCount(group.directMembersCount),
          });
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken && groups.length < maxResults);

    return groups;
  }

  /**
   * Get group by email
   */
  async getGroup(userEmail: string, groupEmail: string): Promise<Group | null> {
    const dir = await this.adminFor(userEmail);

    try {
      const response = await this.withRetry(() =>
        dir.groups.get({
          groupKey: groupEmail,
        })
      );

      return {
        id: response.data.id || '',
        email: response.data.email || '',
        name: response.data.name || '',
        description: response.data.description,
        adminCreated: response.data.adminCreated === true,
        directMembersCount: this.normalizeMembersCount(response.data.directMembersCount),
      };
    } catch (error: any) {
      const status = error?.response?.status ?? error?.code ?? error?.status;
      if (status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create a new group
   */
  async createGroup(
    userEmail: string,
    groupData: {
      email: string;
      name: string;
      description?: string;
    }
  ): Promise<Group> {
    const dir = await this.adminFor(userEmail);

    const response = await this.withRetry(() =>
      dir.groups.insert({
        requestBody: {
          email: groupData.email,
          name: groupData.name,
          description: groupData.description,
        },
      })
    );

    return {
      id: response.data.id || '',
      email: response.data.email || '',
      name: response.data.name || '',
      description: response.data.description,
      adminCreated: response.data.adminCreated === true,
      directMembersCount: this.normalizeMembersCount(response.data.directMembersCount),
    };
  }

  /**
   * Update group
   */
  async updateGroup(
    userEmail: string,
    groupEmail: string,
    updates: Partial<{
      name: string;
      description: string;
    }>
  ): Promise<Group> {
    const dir = await this.adminFor(userEmail);

    const response = await this.withRetry(() =>
      dir.groups.patch({
        groupKey: groupEmail,
        requestBody: updates,
      })
    );

    return {
      id: response.data.id || '',
      email: response.data.email || '',
      name: response.data.name || '',
      description: response.data.description,
      adminCreated: response.data.adminCreated === true,
      directMembersCount: this.normalizeMembersCount(response.data.directMembersCount),
    };
  }

  /**
   * Delete group
   */
  async deleteGroup(userEmail: string, groupEmail: string): Promise<void> {
    const dir = await this.adminFor(userEmail);

    await this.withRetry(() =>
      dir.groups.delete({
        groupKey: groupEmail,
      })
    );
  }

  /**
   * List group members
   */
  async listMembers(userEmail: string, groupEmail: string): Promise<GroupMember[]> {
    const dir = await this.adminFor(userEmail);

    const members: GroupMember[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.withRetry(() =>
        dir.members.list({
          groupKey: groupEmail,
          pageToken,
        })
      );

      if (response.data.members) {
        for (const member of response.data.members) {
          members.push({
            id: member.id || '',
            email: member.email || '',
            role: (member.role as 'OWNER' | 'MANAGER' | 'MEMBER') || 'MEMBER',
            type: (member.type as 'USER' | 'GROUP' | 'CUSTOMER' | 'EXTERNAL') || 'USER',
            status: member.status || '',
          });
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return members;
  }

  /**
   * Get all groups a user is a member of
   */
  async getGroupsForUser(userEmail: string, memberEmail: string): Promise<Group[]> {
    const dir = await this.adminFor(userEmail);

    // Get all groups
    const allGroups = await this.listGroups(userEmail, 1000);
    
    // Filter groups where the user is a member
    const userGroups: Group[] = [];
    for (const group of allGroups) {
      try {
        const members = await this.listMembers(userEmail, group.email);
        if (members.some(m => m.email.toLowerCase() === memberEmail.toLowerCase())) {
          userGroups.push(group);
        }
      } catch (error) {
        // Skip groups we can't access
        console.warn(`Could not check membership for group ${group.email}:`, error);
      }
    }

    return userGroups;
  }

  /**
   * Add member to group
   */
  async addMember(
    userEmail: string,
    groupEmail: string,
    memberEmail: string,
    role: 'OWNER' | 'MANAGER' | 'MEMBER' = 'MEMBER'
  ): Promise<GroupMember> {
    const dir = await this.adminFor(userEmail);

    const response = await this.withRetry(() =>
      dir.members.insert({
        groupKey: groupEmail,
        requestBody: {
          email: memberEmail,
          role,
        },
      })
    );

    return {
      id: response.data.id || '',
      email: response.data.email || '',
      role: (response.data.role as 'OWNER' | 'MANAGER' | 'MEMBER') || 'MEMBER',
      type: (response.data.type as 'USER' | 'GROUP' | 'CUSTOMER' | 'EXTERNAL') || 'USER',
      status: response.data.status || '',
    };
  }

  /**
   * Update group member role
   */
  async updateMember(
    userEmail: string,
    groupEmail: string,
    memberEmail: string,
    role: 'OWNER' | 'MANAGER' | 'MEMBER'
  ): Promise<GroupMember> {
    const dir = await this.adminFor(userEmail);

    const response = await this.withRetry(() =>
      dir.members.patch({
        groupKey: groupEmail,
        memberKey: memberEmail,
        requestBody: {
          role,
        },
      })
    );

    return {
      id: response.data.id || '',
      email: response.data.email || '',
      role: (response.data.role as 'OWNER' | 'MANAGER' | 'MEMBER') || 'MEMBER',
      type: (response.data.type as 'USER' | 'GROUP' | 'CUSTOMER' | 'EXTERNAL') || 'USER',
      status: response.data.status || '',
    };
  }

  /**
   * Remove member from group
   */
  async removeMember(userEmail: string, groupEmail: string, memberEmail: string): Promise<void> {
    const dir = await this.adminFor(userEmail);

    await this.withRetry(() =>
      dir.members.delete({
        groupKey: groupEmail,
        memberKey: memberEmail,
      })
    );
  }

  /**
   * List groups that have at least one external member (type CUSTOMER or EXTERNAL)
   */
  async listGroupsWithExternalMembers(userEmail: string, maxGroups: number = 500): Promise<Group[]> {
    const dir = await this.adminFor(userEmail);
    const allGroups = await this.listGroups(userEmail, maxGroups);
    const workspaceDomain = String(process.env.WORKSPACE_DOMAIN || '').toLowerCase();

    // Only groups with members can have external members; skip empties up front.
    const candidates = allGroups.filter((g) => (g.directMembersCount || 0) > 0);

    let firstError: any = null;
    let failures = 0;

    const scanned = await mapWithConcurrency(candidates, 8, async (group) => {
      try {
        const members = await this.listMembers(userEmail, group.email);
        const hasExternal = members.some((m) => {
          if (m.type === 'CUSTOMER' || m.type === 'EXTERNAL') return true;
          if (!m.email || !workspaceDomain) return false;
          const memberDomain = m.email.split('@')[1]?.toLowerCase();
          return Boolean(memberDomain && memberDomain !== workspaceDomain);
        });
        return hasExternal ? group : null;
      } catch (error: any) {
        failures++;
        if (!firstError) firstError = error;
        console.warn(`Could not list members for group ${group.email}:`, error?.message || error);
        return null;
      }
    });

    // If EVERY member lookup failed, this is a systemic problem (missing scope,
    // insufficient privileges, rate limiting) rather than a genuinely empty
    // result. Surface the real error so the client shows an actionable message
    // instead of a misleadingly empty "Externally Shared" tab.
    if (candidates.length > 0 && failures === candidates.length && firstError) {
      throw firstError;
    }

    return scanned.filter((g): g is Group => g !== null);
  }
}

export const groupsService = new GroupsService();
