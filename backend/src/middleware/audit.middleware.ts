import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { auditLogService } from '../services/audit-log.service';

/**
 * Middleware to log admin actions for audit purposes
 * Only logs mutations (create, update, delete operations)
 */
export function auditLog(action: string, resourceType: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    // Capture original response methods
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    
    // Track response
    let responseBody: any;
    let statusCode = 200;
    
    // Override res.json to capture response
    res.json = function(body: any) {
      responseBody = body;
      statusCode = res.statusCode;
      return originalJson(body);
    };
    
    // Override res.send to capture response
    res.send = function(body: any) {
      responseBody = body;
      statusCode = res.statusCode;
      return originalSend(body);
    };
    
    // Get resource info from request
    const resourceId = req.params.id || 
                      req.params.email || 
                      req.params.fileId || 
                      req.params.groupEmail ||
                      req.params.resourceId ||
                      req.params.permissionId ||
                      req.params.delegateEmail ||
                      req.params.sendAsEmail ||
                      'unknown';
    
    // Extract resource name from response or params
    let resourceName: string | undefined;
    if (responseBody) {
      resourceName = responseBody.name || 
                    responseBody.primaryEmail ||
                    responseBody.email ||
                    responseBody.resourceName ||
                    undefined;
    }
    
    // Capture before state for updates (from request body if available)
    const beforeState = req.body?.before || undefined;
    const afterState = responseBody || undefined;
    
    // Log after response is sent
    res.on('finish', async () => {
      try {
        // Only log if this was a mutation (not a read operation)
        // Status codes 2xx for success, 4xx/5xx for errors
        const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method);
        
        if (isMutation) {
          await auditLogService.log({
            timestamp: new Date().toISOString(),
            userId: req.user?.email || 'unknown',
            userEmail: req.user?.email || 'unknown',
            userName: req.user?.name || 'unknown',
            action,
            resourceType,
            resourceId: String(resourceId),
            resourceName,
            ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 
                      req.ip || 
                      req.socket.remoteAddress ||
                      undefined,
            userAgent: req.headers['user-agent'],
            success: statusCode >= 200 && statusCode < 400,
            errorMessage: statusCode >= 400 ? (responseBody?.error || 'Unknown error') : undefined,
            changes: beforeState || afterState ? {
              before: beforeState,
              after: afterState,
            } : undefined,
          });
        }
      } catch (error) {
        // Don't fail the request if logging fails
        console.error('Failed to write audit log:', error);
      }
    });
    
    next();
  };
}
