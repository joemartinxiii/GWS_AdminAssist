import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { permissionsService, Permission } from '../services/permissions.service';

// Cache permissions to avoid repeated API calls
const permissionsCache = new Map<string, { permissions: Permission[]; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Middleware factory to require specific permission(s)
 * Usage: router.post('/', requirePermission('users.create'), handler)
 */
export function requirePermission(...requiredPermissions: Permission[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.email) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const userEmail = req.user.email;
      
      // Check cache first
      let permissions: Permission[];
      const cached = permissionsCache.get(userEmail);
      
      if (cached && cached.expiresAt > Date.now()) {
        permissions = cached.permissions;
      } else {
        // Fetch permissions from Google Workspace
        permissions = await permissionsService.getUserPermissions(userEmail);
        
        // Cache the result
        permissionsCache.set(userEmail, {
          permissions,
          expiresAt: Date.now() + CACHE_TTL,
        });
      }

      // Check if user has all required permissions
      const hasAllPermissions = requiredPermissions.every(permission => 
        permissions.includes(permission)
      );

      if (!hasAllPermissions) {
        const missing = requiredPermissions.filter(p => !permissions.includes(p));
        res.status(403).json({ 
          error: 'Insufficient permissions',
          required: requiredPermissions,
          missing,
        });
        return;
      }

      next();
    } catch (error: unknown) {
      console.error('Error checking permissions:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to verify permissions';
      // Propagate detailed config/role errors from permissionsService
      res.status(500).json({ 
        error: errorMessage.includes('Secret Manager') || errorMessage.includes('delegation') || errorMessage.includes('Domain-wide') 
          ? errorMessage 
          : 'Failed to verify permissions. Check server logs.' 
      });
    }
  };
}

/**
 * Middleware to require any admin role (super or delegated)
 * Usage: router.get('/', requireAnyAdmin, handler)
 */
export async function requireAnyAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user?.email) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const adminRole = await permissionsService.getAdminRoles(req.user.email);
    
    if (!adminRole.isSuperAdmin && !adminRole.isDelegatedAdmin) {
      res.status(403).json({ 
        error: 'Admin privileges required. You must be a Google Workspace admin to use this application.' 
      });
      return;
    }

    next();
  } catch (error: unknown) {
    console.error('Error verifying admin status:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to verify admin privileges';
    res.status(500).json({ 
      error: errorMessage.includes('Secret Manager') || errorMessage.includes('delegation') || errorMessage.includes('Domain-wide') 
        ? errorMessage 
        : 'Failed to verify admin privileges. Check server logs and SECURITY.md.' 
    });
  }
}

/**
 * Google Workspace super admin only (isAdmin in Admin SDK).
 * Use for mutations and side effects; delegated admins get 403.
 */
export async function requireSuperAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user?.email) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const adminRole = await permissionsService.getAdminRoles(req.user.email);

    if (!adminRole.isSuperAdmin) {
      res.status(403).json({
        error: 'Super admin privileges required for this action.',
      });
      return;
    }

    next();
  } catch (error: unknown) {
    console.error('Error verifying super admin status:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to verify super admin privileges';
    res.status(500).json({ 
      error: errorMessage.includes('Secret Manager') || errorMessage.includes('delegation') || errorMessage.includes('Domain-wide') 
        ? errorMessage 
        : 'Failed to verify super admin privileges. Check server logs and SECURITY.md.' 
    });
  }
}
