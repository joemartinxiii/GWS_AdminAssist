import { useEffect, useState } from 'react';
import { permissionsService, Permission, UserPermissions } from '../services/permissions.service';

export function usePermissions() {
  const [permissions, setPermissions] = useState<UserPermissions>({
    permissions: [],
    isSuperAdmin: false,
    isDelegatedAdmin: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPermissions();
  }, []);

  const loadPermissions = async () => {
    setLoading(true);
    const perms = await permissionsService.fetchPermissions();
    setPermissions(perms);
    setLoading(false);
  };

  const hasPermission = (permission: Permission): boolean => {
    return permissionsService.hasPermission(permission);
  };

  const hasAnyPermission = (...perms: Permission[]): boolean => {
    return permissionsService.hasAnyPermission(...perms);
  };

  return {
    permissions: permissions.permissions,
    isSuperAdmin: permissions.isSuperAdmin,
    isDelegatedAdmin: permissions.isDelegatedAdmin,
    /** Mutations and exports: backend enforces super admin; use for UI affordances */
    canTakeAction: permissions.isSuperAdmin,
    /** Set when the permissions request failed (degraded mode). */
    error: permissions.error ?? null,
    loading,
    hasPermission,
    hasAnyPermission,
    refresh: loadPermissions,
  };
}
