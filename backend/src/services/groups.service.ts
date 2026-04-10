import { WorkspaceService } from './workspace.service';

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
  /**
   * List all groups in the domain
   */
  async listGroups(userEmail: string, maxResults: number = 500): Promise<Group[]> {
    await this.initialize(userEmail);

    const groups: Group[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.withRetry(() =>
        this.groups.groups.list({
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
            directMembersCount: group.directMembersCount,
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
    await this.initialize(userEmail);

    try {
      const response = await this.withRetry(() =>
        this.groups.groups.get({
          groupKey: groupEmail,
        })
      );

      return {
        id: response.data.id || '',
        email: response.data.email || '',
        name: response.data.name || '',
        description: response.data.description,
        adminCreated: response.data.adminCreated === true,
        directMembersCount: response.data.directMembersCount,
      };
    } catch (error: any) {
      if (error.status === 404) {
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
    await this.initialize(userEmail);

    const response = await this.withRetry(() =>
      this.groups.groups.insert({
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
      directMembersCount: response.data.directMembersCount,
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
    await this.initialize(userEmail);

    const response = await this.withRetry(() =>
      this.groups.groups.patch({
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
      directMembersCount: response.data.directMembersCount,
    };
  }

  /**
   * Delete group
   */
  async deleteGroup(userEmail: string, groupEmail: string): Promise<void> {
    await this.initialize(userEmail);

    await this.withRetry(() =>
      this.groups.groups.delete({
        groupKey: groupEmail,
      })
    );
  }

  /**
   * List group members
   */
  async listMembers(userEmail: string, groupEmail: string): Promise<GroupMember[]> {
    await this.initialize(userEmail);

    const members: GroupMember[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.withRetry(() =>
        this.groups.members.list({
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
    await this.initialize(userEmail);

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
    await this.initialize(userEmail);

    const response = await this.withRetry(() =>
      this.groups.members.insert({
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
    await this.initialize(userEmail);

    const response = await this.withRetry(() =>
      this.groups.members.patch({
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
    await this.initialize(userEmail);

    await this.withRetry(() =>
      this.groups.members.delete({
        groupKey: groupEmail,
        memberKey: memberEmail,
      })
    );
  }

  /**
   * List groups that have at least one external member (type CUSTOMER or EXTERNAL)
   */
  async listGroupsWithExternalMembers(userEmail: string, maxGroups: number = 500): Promise<Group[]> {
    await this.initialize(userEmail);
    const allGroups = await this.listGroups(userEmail, maxGroups);
    const result: Group[] = [];

    for (const group of allGroups) {
      if ((group.directMembersCount || 0) === 0) continue;
      try {
        const members = await this.listMembers(userEmail, group.email);
        const hasExternal = members.some(
          (m) => m.type === 'CUSTOMER' || m.type === 'EXTERNAL'
        );
        if (hasExternal) result.push(group);
      } catch {
        // Skip group if we can't list members
      }
    }

    return result;
  }
}

export const groupsService = new GroupsService();
