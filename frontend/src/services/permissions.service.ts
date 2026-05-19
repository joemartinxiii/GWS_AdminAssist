import { apiClient } from './api.client';

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
  | 'gmail.view'
  | 'gmail.delegation.manage'
  | 'gmail.sendas.manage'
  | 'calendar.resources.manage'
  | 'calendar.view'
  | 'audit.view'
  | 'audit.export';

export interface UserPermissions {
  permissions: Permission[];
  isSuperAdmin: boolean;
  isDelegatedAdmin: boolean;
}

class PermissionsService {
  private permissions: Permission[] | null = null;
  private isSuperAdmin: boolean = false;
  private isDelegatedAdmin: boolean = false;
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  async fetchPermissions(): Promise<UserPermissions> {
    // Check cache
    if (this.permissions && Date.now() < this.cacheExpiry) {
      return {
        permissions: this.permissions,
        isSuperAdmin: this.isSuperAdmin,
        isDelegatedAdmin: this.isDelegatedAdmin,
      };
    }

    try {
      const response = await apiClient.get<UserPermissions>('/auth/permissions');
      this.permissions = response.data.permissions;
      this.isSuperAdmin = response.data.isSuperAdmin;
      this.isDelegatedAdmin = response.data.isDelegatedAdmin;
      this.cacheExpiry = Date.now() + this.CACHE_TTL;
      
      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
      console.error('Error fetching permissions:', errorMsg);
      console.warn(
        'Permission fetch error (common in prod): If mentions Secret Manager, delegation, or admin roles, ' +
        'verify SA IAM, domain-wide delegation scopes (SECURITY.md), and run setup-secrets.sh/deploy.sh. ' +
        'User may be delegated admin (view-only).'
      );
      // Return empty permissions on error (UI shows view-only / disabled actions)
      return {
        permissions: [],
        isSuperAdmin: false,
        isDelegatedAdmin: false,
      };
    }
  }

  hasPermission(permission: Permission): boolean {
    if (!this.permissions) return false;
    return this.permissions.includes(permission);
  }

  hasAnyPermission(...permissions: Permission[]): boolean {
    if (!this.permissions) return false;
    return permissions.some(p => this.permissions!.includes(p));
  }

  hasAllPermissions(...permissions: Permission[]): boolean {
    if (!this.permissions) return false;
    return permissions.every(p => this.permissions!.includes(p));
  }

  clearCache(): void {
    this.permissions = null;
    this.cacheExpiry = 0;
  }

  // Helper methods for common permission checks
  canViewUsers(): boolean {
    return this.hasPermission('users.view');
  }

  canManageUsers(): boolean {
    return this.hasAnyPermission('users.create', 'users.update', 'users.delete');
  }

  canViewGroups(): boolean {
    return this.hasPermission('groups.view');
  }

  canManageGroups(): boolean {
    return this.hasAnyPermission('groups.create', 'groups.update', 'groups.delete');
  }

  canViewDrive(): boolean {
    return this.hasPermission('drive.view');
  }

  canManageDrive(): boolean {
    return this.hasPermission('drive.permissions.manage');
  }

  canViewGmail(): boolean {
    return this.hasPermission('gmail.view');
  }

  canViewCalendar(): boolean {
    return this.hasPermission('calendar.view');
  }

  canManageCalendar(): boolean {
    return this.hasPermission('calendar.resources.manage');
  }

  canViewAudit(): boolean {
    return this.hasPermission('audit.view');
  }
}

export const permissionsService = new PermissionsService();
