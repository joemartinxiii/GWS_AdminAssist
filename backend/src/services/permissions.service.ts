import { WorkspaceService } from './workspace.service';

export type Permission = 
  | 'users.create'
  | 'users.update'
  | 'users.delete'
  | 'users.view'
  | 'groups.create'
  | 'groups.update'
  | 'groups.delete'
  | 'groups.view'
  | 'drive.permissions.manage'
  | 'drive.view'
  /** Read-only Gmail areas (delegation / signatures UI); mutations use manage permissions */
  | 'gmail.view'
  | 'gmail.delegation.manage'
  | 'gmail.sendas.manage'
  | 'calendar.resources.manage'
  | 'calendar.view'
  | 'audit.view'
  | 'audit.export';

export interface AdminRole {
  isSuperAdmin: boolean;
  isDelegatedAdmin: boolean;
  delegatedAdminPrivileges?: string[];
  orgUnitPath?: string;
}

export class PermissionsService extends WorkspaceService {
  /**
   * Get user's admin roles and privileges from Google Workspace
   */
  async getAdminRoles(userEmail: string): Promise<AdminRole> {
    await this.initialize(userEmail);
    
    const response = await this.withRetry(() =>
      this.admin.users.get({
        userKey: userEmail,
        projection: 'full',
      })
    );

    const user = response.data;
    
    return {
      isSuperAdmin: user.isAdmin === true,
      isDelegatedAdmin: user.isDelegatedAdmin === true,
      delegatedAdminPrivileges: user.delegatedAdminPrivileges || [],
      orgUnitPath: user.orgUnitPath,
    };
  }

  /**
   * Map Google Workspace admin roles to app permissions
   */
  getPermissions(adminRole: AdminRole): Permission[] {
    // Super Admin gets everything (including all mutations)
    if (adminRole.isSuperAdmin) {
      return [
        'users.create',
        'users.update',
        'users.delete',
        'users.view',
        'groups.create',
        'groups.update',
        'groups.delete',
        'groups.view',
        'drive.permissions.manage',
        'drive.view',
        'gmail.view',
        'gmail.delegation.manage',
        'gmail.sendas.manage',
        'calendar.resources.manage',
        'calendar.view',
        'audit.view',
        'audit.export',
      ];
    }

    // Delegated admins: view-only across the app; mutations require super admin (enforced via permissions + requireSuperAdmin on exports)
    if (adminRole.isDelegatedAdmin) {
      return [
        'users.view',
        'groups.view',
        'drive.view',
        'calendar.view',
        'audit.view',
        'gmail.view',
      ];
    }

    return [];
  }

  /**
   * Check if user has a specific permission
   */
  async hasPermission(userEmail: string, permission: Permission): Promise<boolean> {
    const adminRole = await this.getAdminRoles(userEmail);
    const permissions = this.getPermissions(adminRole);
    return permissions.includes(permission);
  }

  /**
   * Get all permissions for a user
   */
  async getUserPermissions(userEmail: string): Promise<Permission[]> {
    const adminRole = await this.getAdminRoles(userEmail);
    return this.getPermissions(adminRole);
  }
}

export const permissionsService = new PermissionsService();
