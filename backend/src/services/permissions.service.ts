import { WorkspaceService } from './workspace.service';

/**
 * Google Workspace Directory User response shape (from Admin SDK users.get with projection=full).
 * These fields are not always in the strict googleapis types, hence the interface.
 */
interface DirectoryUser {
  isAdmin?: boolean;
  isDelegatedAdmin?: boolean;
  delegatedAdminPrivileges?: string[];
  orgUnitPath?: string;
  primaryEmail?: string;
  name?: { fullName?: string };
  // Add other commonly used fields as needed
}

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
    try {
      const admin = await this.adminFor(userEmail);
      
      const response = await this.withRetry(() =>
        admin.users.get({
          userKey: userEmail,
          projection: 'full',
        })
      );

      const user = response.data as DirectoryUser;
      
      return {
        isSuperAdmin: user.isAdmin === true,
        isDelegatedAdmin: user.isDelegatedAdmin === true,
        delegatedAdminPrivileges: user.delegatedAdminPrivileges || [],
        orgUnitPath: user.orgUnitPath,
      };
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      const message = err.message;
      // Provide clear, actionable errors for common Cloud Run / SA / delegation issues
      if (message.includes('secret') || message.includes('SecretManager') || (message.includes('403') && message.includes('access'))) {
        throw new Error(`Secret Manager or IAM configuration error. Run './setup-secrets.sh <project>' and apply all printed IAM commands (see SECURITY.md). Details: ${message}`);
      }
      if (message.includes('delegation') || message.includes('Forbidden') || message.includes('403') || message.includes('insufficient')) {
        throw new Error(`Domain-wide delegation or admin privileges issue for ${userEmail}. Verify SA scopes in GWS Admin Console match SECURITY.md exactly, and confirm user is a Workspace admin. Details: ${message}`);
      }
      console.error('getAdminRoles failed:', error);
      throw new Error(`Failed to fetch admin roles for ${userEmail}: ${message}`);
    }
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
