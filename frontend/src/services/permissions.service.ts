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
  /** Set when the permissions request failed; drives the degraded-mode banner. */
  error?: string | null;
}

class PermissionsService {
  private permissions: Permission[] | null = null;
  private isSuperAdmin: boolean = false;
  private isDelegatedAdmin: boolean = false;
  private cacheExpiry: number = 0;
  private loadError: string | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  async fetchPermissions(): Promise<UserPermissions> {
    // Check cache
    if (this.permissions && Date.now() < this.cacheExpiry) {
      return {
        permissions: this.permissions,
        isSuperAdmin: this.isSuperAdmin,
        isDelegatedAdmin: this.isDelegatedAdmin,
        error: this.loadError,
      };
    }

    try {
      const response = await apiClient.get<UserPermissions>('/auth/permissions');
      this.permissions = response.data.permissions;
      this.isSuperAdmin = response.data.isSuperAdmin;
      this.isDelegatedAdmin = response.data.isDelegatedAdmin;
      this.cacheExpiry = Date.now() + this.CACHE_TTL;
      this.loadError = null;

      return { ...response.data, error: null };
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
      const hint = error.response?.data?.hint;
      console.error('Error fetching permissions:', errorMsg);
      // Surface a degraded-mode message rather than silently emptying the UI.
      // An empty permission set makes navigation items and action buttons
      // disappear; without this signal the user has no idea why.
      this.permissions = [];
      this.isSuperAdmin = false;
      this.isDelegatedAdmin = false;
      this.cacheExpiry = 0; // do not cache a failure
      this.loadError = hint ? `${errorMsg} ${hint}` : errorMsg;

      return {
        permissions: [],
        isSuperAdmin: false,
        isDelegatedAdmin: false,
        error: this.loadError,
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
