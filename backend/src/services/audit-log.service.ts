import { Logging } from '@google-cloud/logging';

export interface AuditLogEntry {
  timestamp: string;
  userId: string;
  userEmail: string;
  userName: string;
  action: string; // "user.create", "user.update", "user.delete", "drive.permission.update", etc.
  resourceType: string; // "user", "drive", "group", "gmail", "calendar"
  resourceId: string;
  resourceName?: string;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
  changes?: {
    before?: any;
    after?: any;
  };
}

export class AuditLogService {
  private logging: Logging | null = null;
  private logName: string;

  constructor() {
    this.logName = 'workspace-admin-audit';
    
    // Initialize logging client if GCP_PROJECT_ID is set
    if (process.env.GCP_PROJECT_ID) {
      try {
        this.logging = new Logging({
          projectId: process.env.GCP_PROJECT_ID,
        });
      } catch (error) {
        console.warn('Failed to initialize Cloud Logging:', error);
      }
    }
  }

  async log(entry: AuditLogEntry): Promise<void> {
    // Skip logging if not initialized (e.g., local development)
    if (!this.logging) {
      console.log('Audit Log (not sent to Cloud):', JSON.stringify(entry, null, 2));
      return;
    }

    try {
      const log = this.logging.log(this.logName);
      
      const metadata = {
        resource: {
          type: 'global',
        },
        severity: entry.success ? 'INFO' : 'ERROR',
        labels: {
          userId: entry.userEmail,
          action: entry.action,
          resourceType: entry.resourceType,
        },
      };

      const logEntry = log.entry(metadata, {
        ...entry,
        // Store as structured data for easy querying
      });

      await log.write(logEntry);
    } catch (error) {
      // Don't fail the request if logging fails
      console.error('Failed to write audit log:', error);
    }
  }

  async query(filters: {
    userId?: string;
    action?: string;
    resourceType?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<AuditLogEntry[]> {
    if (!this.logging) {
      console.warn('Cloud Logging not initialized, cannot query logs');
      return [];
    }

    try {
      const log = this.logging.log(this.logName);
      
      let query = `resource.type="global" AND logName="projects/${process.env.GCP_PROJECT_ID}/logs/${this.logName}"`;
      
      if (filters.userId) {
        query += ` AND jsonPayload.userEmail="${filters.userId}"`;
      }
      if (filters.action) {
        query += ` AND jsonPayload.action="${filters.action}"`;
      }
      if (filters.resourceType) {
        query += ` AND jsonPayload.resourceType="${filters.resourceType}"`;
      }
      if (filters.startDate) {
        query += ` AND timestamp>="${filters.startDate.toISOString()}"`;
      }
      if (filters.endDate) {
        query += ` AND timestamp<="${filters.endDate.toISOString()}"`;
      }

      const [entries] = await log.getEntries({
        filter: query,
        pageSize: filters.limit || 1000,
        orderBy: 'timestamp desc',
      });

      return entries.map(entry => {
        const data = entry.data as any;
        return {
          timestamp: entry.metadata.timestamp || new Date().toISOString(),
          userId: data.userId || '',
          userEmail: data.userEmail || '',
          userName: data.userName || '',
          action: data.action || '',
          resourceType: data.resourceType || '',
          resourceId: data.resourceId || '',
          resourceName: data.resourceName,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
          success: data.success !== false,
          errorMessage: data.errorMessage,
          changes: data.changes,
        };
      });
    } catch (error) {
      console.error('Error querying audit logs:', error);
      throw error;
    }
  }

  async exportToCSV(filters: {
    userId?: string;
    action?: string;
    resourceType?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<string> {
    const entries = await this.query({ ...filters, limit: 10000 });
    
    if (entries.length === 0) {
      return 'No entries found';
    }

    const headers = [
      'Timestamp',
      'User Email',
      'User Name',
      'Action',
      'Resource Type',
      'Resource ID',
      'Resource Name',
      'IP Address',
      'Success',
      'Error Message',
    ];

    const rows = entries.map(entry => [
      entry.timestamp,
      entry.userEmail,
      entry.userName,
      entry.action,
      entry.resourceType,
      entry.resourceId,
      entry.resourceName || '',
      entry.ipAddress || '',
      entry.success ? 'Yes' : 'No',
      entry.errorMessage || '',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => {
        const str = String(cell || '');
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(','))
    ].join('\n');

    return csv;
  }
}

export const auditLogService = new AuditLogService();
