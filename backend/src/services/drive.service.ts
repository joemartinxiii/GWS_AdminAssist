// @ts-nocheck - Temporary to allow deployment (many Google API response types are `unknown`)
import { WorkspaceService } from './workspace.service';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  driveId?: string;
  owners: Array<{ emailAddress: string; displayName: string }>;
  shared: boolean;
  permissions: Array<{
    id: string;
    type: string;
    role: string;
    emailAddress?: string;
    domain?: string;
    displayName?: string;
  }>;
  webViewLink: string;
  modifiedTime: string;
  createdTime?: string;
  size?: string;
  webContentLink?: string;
  thumbnailLink?: string;
  description?: string;
  starred?: boolean;
  trashed?: boolean;
  version?: string;
  parents?: string[];
  path?: string;
}

export interface ExternalSharingReport {
  file: DriveFile;
  externalDomains: string[];
  externalEmails: string[];
}

export interface DriveFileFilter {
  domain?: string;
  owner?: string;
  mimeType?: string;
  minSize?: number;
  maxSize?: number;
  createdAfter?: string;
  createdBefore?: string;
  modifiedAfter?: string;
  modifiedBefore?: string;
  pathContains?: string;
  nameContains?: string;
  shared?: boolean;
  externallyShared?: boolean;
}

export class DriveService extends WorkspaceService {
  private filePathCache = new Map<string, string>();

  /**
   * Get file path with caching to avoid repeated API calls
   */
  private async getFilePathCached(userEmail: string, fileId: string, parents?: string[]): Promise<string> {
    if (this.filePathCache.has(fileId)) {
      return this.filePathCache.get(fileId)!;
    }

    const path = await this.getFilePath(userEmail, fileId, parents);
    this.filePathCache.set(fileId, path);
    return path;
  }
  private buildDriveQuery(filter?: DriveFileFilter): string {
    let query = 'trashed=false';
    if (filter?.mimeType) query += ` and mimeType='${filter.mimeType}'`;
    if (filter?.nameContains) query += ` and name contains '${filter.nameContains}'`;
    return query;
  }

  private classifyExternalSharing(
    permissions: DriveFile['permissions'],
    workspaceDomain: string,
    domainFilter?: string
  ): { externalDomains: string[]; externalEmails: string[] } {
    const externalDomains: string[] = [];
    const externalEmails: string[] = [];
    const wsDomain = workspaceDomain.toLowerCase();
    const filterDomain = (domainFilter || '').toLowerCase();

    for (const perm of permissions) {
      if (perm.type === 'domain' && perm.domain) {
        const permDomain = perm.domain.toLowerCase();
        if (permDomain !== wsDomain && (!filterDomain || permDomain === filterDomain)) {
          externalDomains.push(perm.domain);
        }
      } else if ((perm.type === 'user' || perm.type === 'group') && perm.emailAddress) {
        const emailDomain = perm.emailAddress.split('@')[1]?.toLowerCase();
        if (emailDomain && emailDomain !== wsDomain && (!filterDomain || emailDomain === filterDomain)) {
          externalEmails.push(perm.emailAddress);
          if (!externalDomains.some((d) => d.toLowerCase() === emailDomain)) {
            externalDomains.push(emailDomain);
          }
        }
      } else if (perm.type === 'anyone' && !filterDomain) {
        if (!externalDomains.includes('anyone')) {
          externalDomains.push('anyone');
        }
      }
    }

    return { externalDomains, externalEmails };
  }

  private async listSharedDriveIds(): Promise<string[]> {
    const driveIds: string[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.withRetry(() =>
        this.drive.drives.list({
          pageSize: 100,
          pageToken,
          useDomainAdminAccess: true,
          fields: 'nextPageToken, drives(id)',
        })
      );

      for (const drive of response.data.drives || []) {
        if (drive.id) driveIds.push(drive.id);
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return driveIds;
  }

  /**
   * Fetch id→name map for all shared drives in one paginated call.
   * Used by bulk scan so we can build paths without per-file API calls.
   */
  private async fetchSharedDriveNames(): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    let pageToken: string | undefined;
    do {
      const response = await this.withRetry(() =>
        this.drive.drives.list({
          pageSize: 100,
          pageToken,
          useDomainAdminAccess: true,
          fields: 'nextPageToken, drives(id, name)',
        })
      );
      for (const drive of response.data.drives || []) {
        if (drive.id && drive.name) names.set(drive.id, drive.name);
      }
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);
    return names;
  }

  /**
   * Build an admin-centric path using only data already present in the file
   * list response — no additional API calls per file.
   *
   * - Shared drive file  → /Shared Drives/<drive-name>/
   * - My Drive file      → /Users/<owner-email>/My Drive/
   */
  private buildFastPath(file: any, sharedDriveNames: Map<string, string>): string {
    const ownerEmail = (file.owners || [])[0]?.emailAddress || 'unknown-owner';
    if (file.driveId) {
      const driveName = sharedDriveNames.get(file.driveId) || file.driveId;
      return `/Shared Drives/${driveName}`;
    }
    return `/Users/${ownerEmail}/My Drive`;
  }

  private async collectAuditCandidates(
    query: string,
    maxResults: number,
    onProgress?: (processed: number) => void
  ): Promise<any[]> {
    const byId = new Map<string, any>();

    const ingest = (file: any) => {
      if (!file?.id) return;
      const existing = byId.get(file.id);
      if (!existing) {
        byId.set(file.id, file);
        onProgress?.(byId.size);
        return;
      }
      const existingPerms = existing.permissions || [];
      const nextPerms = file.permissions || [];
      if (nextPerms.length > existingPerms.length) {
        byId.set(file.id, file);
      }
    };

    let pageToken: string | undefined;
    do {
      const response = await this.withRetry(() =>
        this.drive.files.list({
          q: query,
          fields:
            'nextPageToken, files(id, name, mimeType, driveId, owners, shared, permissions(id, type, role, emailAddress, domain, displayName, deleted, permissionDetails), webViewLink, webContentLink, thumbnailLink, modifiedTime, createdTime, size, description, starred, trashed, version, parents)',
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          useDomainAdminAccess: true,
          corpora: 'allDrives',
          pageSize: 1000,
          pageToken,
        })
      );

      for (const file of response.data.files || []) {
        ingest(file);
        if (byId.size >= maxResults) break;
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken && byId.size < maxResults);

    return Array.from(byId.values());
  }

  /**
   * Map a raw Drive API file to DriveFile.
   * `sharedDriveNames` is optional; when provided the path is built without
   * additional API calls (fast path for bulk scans). When omitted the full
   * recursive path walk is used (single-file lookups from the UI).
   */
  private async mapToDriveFile(
    userEmail: string,
    file: any,
    sharedDriveNames?: Map<string, string>
  ): Promise<DriveFile> {
    const permissions = (file.permissions || [])
      .filter((perm: any) => !perm.deleted)
      .map((perm: any) => ({
        id: perm.id || '',
        type: perm.type || '',
        role: perm.role || '',
        emailAddress: perm.emailAddress || undefined,
        domain: perm.domain || undefined,
        displayName: perm.displayName || undefined,
      }));

    let adminPath: string;
    if (sharedDriveNames) {
      // Fast path: no extra API calls — use data already in the list response
      adminPath = this.buildFastPath(file, sharedDriveNames);
    } else {
      const parents = file.parents || [];
      const filePath = await this.getFilePathCached(userEmail, file.id!, parents.length > 0 ? parents : undefined);
      const ownerEmail = (file.owners || [])[0]?.emailAddress || undefined;
      adminPath = this.toAdminPath(filePath, ownerEmail, file.driveId || undefined);
    }

    return {
      id: file.id!,
      name: file.name || 'Untitled',
      mimeType: file.mimeType || '',
      driveId: file.driveId || undefined,
      owners: (file.owners || []).map((owner: any) => ({
        emailAddress: owner.emailAddress || '',
        displayName: owner.displayName || undefined,
      })),
      shared: file.shared || false,
      permissions,
      webViewLink: file.webViewLink || '',
      modifiedTime: file.modifiedTime || '',
      createdTime: file.createdTime,
      size: file.size,
      webContentLink: file.webContentLink,
      thumbnailLink: file.thumbnailLink,
      description: file.description,
      starred: file.starred,
      trashed: file.trashed,
      version: file.version,
      parents: file.parents,
      path: adminPath,
    };
  }

  private async getSharedDrivePermissionsByDriveId(driveId: string): Promise<DriveFile['permissions']> {
    const permissions: DriveFile['permissions'] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.withRetry(() =>
        this.drive.permissions.list({
          fileId: driveId,
          supportsAllDrives: true,
          useDomainAdminAccess: true,
          fields: 'nextPageToken, permissions(id, type, role, emailAddress, domain, displayName, deleted, permissionDetails)',
          pageSize: 100,
          pageToken,
        })
      );

      for (const perm of response.data.permissions || []) {
        if (perm.deleted) continue;
        permissions.push({
          id: perm.id || '',
          type: perm.type || '',
          role: perm.role || '',
          emailAddress: perm.emailAddress || undefined,
          domain: perm.domain || undefined,
          displayName: perm.displayName || undefined,
        });
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return permissions;
  }

  private mergePermissions(primary: DriveFile['permissions'], inherited: DriveFile['permissions']): DriveFile['permissions'] {
    const merged = new Map<string, DriveFile['permissions'][number]>();
    for (const perm of [...primary, ...inherited]) {
      const identity = perm.emailAddress || perm.domain || perm.id || 'anyone';
      const key = `${perm.type}|${identity}|${perm.role}`;
      if (!merged.has(key)) {
        merged.set(key, perm);
      }
    }
    return Array.from(merged.values());
  }

  private async hydrateEffectivePermissions(
    userEmail: string,
    driveFile: DriveFile,
    sharedDrivePermissionsCache: Map<string, DriveFile['permissions']>
  ): Promise<DriveFile> {
    let directPermissions = driveFile.permissions;
    const hasPrincipalPermissions = directPermissions.some(
      (perm) => perm.type === 'anyone' || !!perm.emailAddress || !!perm.domain || !!perm.displayName
    );

    if (!hasPrincipalPermissions) {
      directPermissions = await this.getFilePermissions(userEmail, driveFile.id);
    }

    if (!driveFile.driveId) {
      return { ...driveFile, permissions: directPermissions };
    }

    let sharedDrivePermissions = sharedDrivePermissionsCache.get(driveFile.driveId);
    if (!sharedDrivePermissions) {
      sharedDrivePermissions = await this.getSharedDrivePermissionsByDriveId(driveFile.driveId);
      sharedDrivePermissionsCache.set(driveFile.driveId, sharedDrivePermissions);
    }

    return {
      ...driveFile,
      permissions: this.mergePermissions(directPermissions, sharedDrivePermissions),
    };
  }

  private toAdminPath(rawPath: string, ownerEmail?: string, driveId?: string): string {
    const normalized = String(rawPath || '').replace(/^\/+/, '');
    const owner = ownerEmail || 'unknown-owner';

    if (normalized.toLowerCase().startsWith('shared drives/')) {
      return `/${normalized}`;
    }
    if (normalized.toLowerCase().startsWith('shared drive/')) {
      return `/Shared Drives/${normalized.slice('Shared Drive/'.length)}`;
    }

    const cleanedMyDrive = normalized
      .replace(/^My Drive\/My Drive/i, 'My Drive')
      .replace(/^My Drive\/?/i, '');

    if (driveId) {
      return cleanedMyDrive ? `/Shared Drives/${cleanedMyDrive}` : '/Shared Drives';
    }

    return cleanedMyDrive
      ? `/Users/${owner}/My Drive/${cleanedMyDrive}`
      : `/Users/${owner}/My Drive`;
  }

  /**
   * Get all Drive files with optional filtering
   */
  async getAllFiles(
    userEmail: string,
    filter?: DriveFileFilter,
    maxResults: number = 1000,
    onProgress?: (processed: number, total?: number) => void
  ): Promise<DriveFile[]> {
    await this.initialize(userEmail);
    const workspaceDomain = process.env.WORKSPACE_DOMAIN || '';
    const [candidates, sharedDriveNames] = await Promise.all([
      this.collectAuditCandidates(
        this.buildDriveQuery(filter),
        maxResults,
        (processed) => onProgress?.(processed, maxResults)
      ),
      this.fetchSharedDriveNames(),
    ]);

    const files: DriveFile[] = [];
    const sharedDrivePermissionsCache = new Map<string, DriveFile['permissions']>();
    for (const candidate of candidates) {
      let driveFile = await this.mapToDriveFile(userEmail, candidate, sharedDriveNames);
      if (driveFile.shared || driveFile.driveId) {
        driveFile = await this.hydrateEffectivePermissions(userEmail, driveFile, sharedDrivePermissionsCache);
      }
      const { externalDomains, externalEmails } = this.classifyExternalSharing(
        driveFile.permissions,
        workspaceDomain,
        filter?.domain
      );

      if (filter?.owner && !driveFile.owners.some((o) => o.emailAddress === filter.owner || o.emailAddress?.includes(filter.owner!))) continue;
      if (filter?.domain && externalDomains.length === 0) continue;
      if (filter?.minSize && (!driveFile.size || parseInt(driveFile.size, 10) < filter.minSize)) continue;
      if (filter?.maxSize && (!driveFile.size || parseInt(driveFile.size, 10) > filter.maxSize)) continue;
      if (filter?.createdAfter && driveFile.createdTime && new Date(driveFile.createdTime) < new Date(filter.createdAfter)) continue;
      if (filter?.createdBefore && driveFile.createdTime && new Date(driveFile.createdTime) > new Date(filter.createdBefore)) continue;
      if (filter?.modifiedAfter && new Date(driveFile.modifiedTime) < new Date(filter.modifiedAfter)) continue;
      if (filter?.modifiedBefore && new Date(driveFile.modifiedTime) > new Date(filter.modifiedBefore)) continue;
      if (filter?.pathContains && !driveFile.path?.toLowerCase().includes(filter.pathContains.toLowerCase())) continue;
      if (filter?.shared !== undefined && driveFile.shared !== filter.shared) continue;
      if (filter?.externallyShared !== undefined) {
        const hasExternal = externalDomains.length > 0 || externalEmails.length > 0;
        if (filter.externallyShared !== hasExternal) continue;
      }

      files.push(driveFile);
      if (files.length >= maxResults) break;
    }

    return files;
  }

  /**
   * Stream all Drive files with batch processing (for large exports)
   */
  async streamAllFiles(
    userEmail: string,
    filter?: DriveFileFilter,
    maxResults: number = 10000,
    onBatch?: (files: DriveFile[]) => boolean
  ): Promise<void> {
    const files = await this.getAllFiles(userEmail, filter, maxResults);
    const batchSize = 100;

    for (let i = 0; i < files.length; i += batchSize) {
      const shouldContinue = onBatch ? onBatch(files.slice(i, i + batchSize)) : true;
      if (!shouldContinue) break;
    }
  }

  /**
   * Get all files shared with external domains
   */
  async getFilesSharedWithExternalDomains(
    userEmail: string,
    domain?: string,
    onProgress?: (processed: number) => void
  ): Promise<ExternalSharingReport[]> {
    await this.initialize(userEmail);
    const workspaceDomain = process.env.WORKSPACE_DOMAIN || '';
    const reports: ExternalSharingReport[] = [];
    const sharedDrivePermissionsCache = new Map<string, DriveFile['permissions']>();
    const [candidates, sharedDriveNames] = await Promise.all([
      this.collectAuditCandidates('trashed=false', 100000, onProgress),
      this.fetchSharedDriveNames(),
    ]);

    for (const candidate of candidates) {
      let driveFile = await this.mapToDriveFile(userEmail, candidate, sharedDriveNames);
      if (driveFile.shared || driveFile.driveId) {
        driveFile = await this.hydrateEffectivePermissions(userEmail, driveFile, sharedDrivePermissionsCache);
      }
      const { externalDomains, externalEmails } = this.classifyExternalSharing(
        driveFile.permissions,
        workspaceDomain,
        domain
      );

      if (externalDomains.length > 0 || externalEmails.length > 0) {
        reports.push({
          file: driveFile,
          externalDomains,
          externalEmails,
        });
      }
    }

    return reports;
  }

  /**
   * Get file path by traversing parent folders.
   * For My Drive files, path starts with "/My Drive/...".
   * For shared drive files, path starts with "/{Shared Drive Name}/..." so the UI can show the drive name.
   */
  async getFilePath(userEmail: string, fileId: string, parents?: string[]): Promise<string> {
    if (!parents || parents.length === 0) {
      return '/My Drive';
    }

    try {
      if (!this.drive) {
        await this.initialize(userEmail);
      }

      const pathParts: string[] = [];
      let currentParentId = parents[0];
      let isSharedDriveRoot = false;

      // Traverse up the folder hierarchy (supportsAllDrives so we can resolve shared drive parents)
      while (currentParentId) {
        if (currentParentId === 'root') {
          return '/My Drive';
        }
        try {
          const parentResponse = await this.drive.files.get({
            fileId: currentParentId,
            fields: 'id, name, parents, driveId',
            supportsAllDrives: true,
            useDomainAdminAccess: true,
          } as any);

          const parentName = parentResponse.data.name || 'Unknown';
          pathParts.unshift(parentName);

          if (parentResponse.data.parents && parentResponse.data.parents.length > 0) {
            currentParentId = parentResponse.data.parents[0];
          } else {
            // Reached root. If it has driveId, it's a shared drive root (not My Drive).
            isSharedDriveRoot = Boolean(parentResponse.data.driveId);
            break;
          }
        } catch (error) {
          break;
        }
      }

      if (pathParts.length === 0) return '/My Drive';
      const pathStr = pathParts.join('/');
      if (isSharedDriveRoot) {
        return `/Shared Drives/${pathStr}`;
      }
      if (pathStr === 'My Drive') {
        return '/My Drive';
      }
      if (pathStr.startsWith('My Drive/')) {
        return `/${pathStr}`;
      }
      return `/My Drive/${pathStr}`;
    } catch (error) {
      console.error(`Error getting file path for ${fileId}:`, error);
      return '/My Drive';
    }
  }

  /**
   * Get file permissions
   */
  async getFilePermissions(userEmail: string, fileId: string): Promise<DriveFile['permissions']> {
    await this.initialize(userEmail);

    try {
      const response = await this.withRetry(() =>
        this.drive.permissions.list({
          fileId,
          supportsAllDrives: true,
          useDomainAdminAccess: true,
          fields: 'permissions(id, type, role, emailAddress, domain, displayName, deleted, permissionDetails)',
        })
      );

      return (response.data.permissions || [])
        .filter(perm => !perm.deleted)
        .map(perm => ({
        id: perm.id || '',
        type: perm.type || '',
        role: perm.role || '',
        emailAddress: perm.emailAddress || undefined,
        domain: perm.domain || undefined,
        displayName: perm.displayName || undefined,
      }));
    } catch (error) {
      console.error(`Error getting permissions for file ${fileId}:`, error);
      return [];
    }
  }

  /**
   * Get file details
   */
  async getFile(userEmail: string, fileId: string): Promise<DriveFile | null> {
    await this.initialize(userEmail);

    try {
      const fileResponse = await this.withRetry(() =>
        this.drive.files.get({
          fileId,
          supportsAllDrives: true,
          useDomainAdminAccess: true,
          fields: 'id, name, mimeType, driveId, owners, shared, webViewLink, webContentLink, thumbnailLink, modifiedTime, createdTime, size, description, starred, trashed, version, parents',
        })
      );

      const directPermissions = await this.getFilePermissions(userEmail, fileId);
      const filePath = await this.getFilePath(userEmail, fileId, fileResponse.data.parents);
      const ownerEmail = (fileResponse.data.owners || [])[0]?.emailAddress || undefined;
      const driveId = fileResponse.data.driveId || undefined;
      const adminPath = this.toAdminPath(filePath, ownerEmail, driveId);
      const permissions = driveId
        ? this.mergePermissions(directPermissions, await this.getSharedDrivePermissionsByDriveId(driveId))
        : directPermissions;

      return {
        id: fileResponse.data.id!,
        name: fileResponse.data.name || 'Untitled',
        mimeType: fileResponse.data.mimeType || '',
        driveId,
        owners: fileResponse.data.owners || [],
        shared: fileResponse.data.shared || false,
        permissions,
        webViewLink: fileResponse.data.webViewLink || '',
        modifiedTime: fileResponse.data.modifiedTime || '',
        createdTime: fileResponse.data.createdTime,
        size: fileResponse.data.size,
        webContentLink: fileResponse.data.webContentLink,
        thumbnailLink: fileResponse.data.thumbnailLink,
        description: fileResponse.data.description,
        starred: fileResponse.data.starred,
        trashed: fileResponse.data.trashed,
        version: fileResponse.data.version,
        parents: fileResponse.data.parents,
        path: adminPath,
      };
    } catch (error: any) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Update file permissions
   */
  async updateFilePermissions(
    userEmail: string,
    fileId: string,
    permissionId: string,
    role: 'reader' | 'commenter' | 'writer'
  ): Promise<void> {
    await this.initialize(userEmail);

    await this.withRetry(() =>
      this.drive.permissions.update({
        fileId,
        permissionId,
        requestBody: { role },
      })
    );
  }

  /**
   * Delete file permission
   */
  async deleteFilePermission(userEmail: string, fileId: string, permissionId: string): Promise<void> {
    await this.initialize(userEmail);

    await this.withRetry(() =>
      this.drive.permissions.delete({
        fileId,
        permissionId,
      })
    );
  }

  /**
   * Remove all external shares from a file
   */
  async removeAllExternalShares(userEmail: string, fileId: string): Promise<{ removed: number; errors: number }> {
    await this.initialize(userEmail);

    const workspaceDomain = process.env.WORKSPACE_DOMAIN || '';
    const permissions = await this.getFilePermissions(userEmail, fileId);
    
    let removed = 0;
    let errors = 0;

    for (const perm of permissions) {
      // Skip owner permissions
      if (perm.role === 'owner') continue;

      // Check if it's an external share
      let isExternal = false;
      if (perm.type === 'domain' && perm.domain && perm.domain !== workspaceDomain) {
        isExternal = true;
      } else if (perm.type === 'user' && perm.emailAddress) {
        const emailDomain = perm.emailAddress.split('@')[1];
        if (emailDomain !== workspaceDomain) {
          isExternal = true;
        }
      } else if (perm.type === 'anyone') {
        // Anyone with link is considered external
        isExternal = true;
      }

      if (isExternal && perm.id) {
        try {
          await this.deleteFilePermission(userEmail, fileId, perm.id);
          removed++;
        } catch (error) {
          console.error(`Error removing permission ${perm.id} from file ${fileId}:`, error);
          errors++;
        }
      }
    }

    return { removed, errors };
  }

  /**
   * Bulk remove external shares from multiple files
   */
  async bulkRemoveExternalShares(userEmail: string, fileIds: string[]): Promise<{
    total: number;
    success: number;
    failed: number;
    results: Array<{ fileId: string; removed: number; errors: number; success: boolean }>;
  }> {
    const results: Array<{ fileId: string; removed: number; errors: number; success: boolean }> = [];
    let success = 0;
    let failed = 0;

    for (const fileId of fileIds) {
      try {
        const result = await this.removeAllExternalShares(userEmail, fileId);
        results.push({
          fileId,
          removed: result.removed,
          errors: result.errors,
          success: result.errors === 0,
        });
        if (result.errors === 0) {
          success++;
        } else {
          failed++;
        }
      } catch (error) {
        console.error(`Error processing file ${fileId}:`, error);
        results.push({
          fileId,
          removed: 0,
          errors: 1,
          success: false,
        });
        failed++;
      }
    }

    return {
      total: fileIds.length,
      success,
      failed,
      results,
    };
  }

  /**
   * Create file permission
   */
  async createFilePermission(
    userEmail: string,
    fileId: string,
    permission: {
      type: 'user' | 'domain' | 'anyone';
      role: 'reader' | 'commenter' | 'writer';
      emailAddress?: string;
      domain?: string;
    }
  ): Promise<void> {
    await this.initialize(userEmail);

    await this.withRetry(() =>
      this.drive.permissions.create({
        fileId,
        requestBody: {
          type: permission.type,
          role: permission.role,
          emailAddress: permission.emailAddress,
          domain: permission.domain,
        },
      })
    );
  }

  /**
   * Upload a file to Google Drive
   */
  async uploadFile(
    userEmail: string,
    fileName: string,
    fileContent: string | Buffer,
    mimeType: string = 'text/csv',
    folderId?: string
  ): Promise<{ id: string; webViewLink: string }> {
    await this.initialize(userEmail);

    const fileMetadata: any = {
      name: fileName,
    };

    if (folderId) {
      fileMetadata.parents = [folderId];
    }

    const media = {
      mimeType,
      body: fileContent,
    };

    const response = await this.withRetry(() =>
      this.drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id, webViewLink',
      })
    );

    return {
      id: response.data.id!,
      webViewLink: response.data.webViewLink || '',
    };
  }
}

export interface SharedDrive {
  id: string;
  name: string;
  kind: string;
  createdTime?: string;
  hidden?: boolean;
  restrictions?: {
    adminManagedRestrictions?: boolean;
    copyRequiresWriterPermission?: boolean;
    domainUsersOnly?: boolean;
    driveMembersOnly?: boolean;
  };
  capabilities?: {
    canAddChildren?: boolean;
    canChangeCopyRequiresWriterPermissionRestriction?: boolean;
    canChangeDomainUsersOnlyRestriction?: boolean;
    canChangeDriveMembersOnlyRestriction?: boolean;
    canChangeSharingFoldersRequireOrganizerPermissionRestriction?: boolean;
    canComment?: boolean;
    canCopy?: boolean;
    canDeleteChildren?: boolean;
    canDeleteDrive?: boolean;
    canDownload?: boolean;
    canEdit?: boolean;
    canListChildren?: boolean;
    canManageMembers?: boolean;
    canReadRevisions?: boolean;
    canRename?: boolean;
    canRenameDrive?: boolean;
    canShare?: boolean;
    canTrashChildren?: boolean;
  };
}

export interface SharedDrivePermission {
  id: string;
  type: 'user' | 'group' | 'domain' | 'anyone';
  role: 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader';
  emailAddress?: string;
  domain?: string;
  displayName?: string;
  deleted?: boolean;
}

export const driveService = new DriveService();

export class SharedDriveService extends WorkspaceService {
  /**
   * List all shared drives
   */
  async listSharedDrives(userEmail: string): Promise<SharedDrive[]> {
    await this.initialize(userEmail);

    const drives: SharedDrive[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.withRetry(() =>
        this.drive.drives.list({
          pageSize: 100,
          pageToken,
          useDomainAdminAccess: true,
          fields: 'nextPageToken, drives(id, name, kind, createdTime, hidden, restrictions, capabilities)',
        })
      );

      if (response.data.drives) {
        for (const drive of response.data.drives) {
          drives.push({
            id: drive.id || '',
            name: drive.name || '',
            kind: drive.kind || '',
            createdTime: drive.createdTime,
            hidden: drive.hidden,
            restrictions: drive.restrictions ? {
              adminManagedRestrictions: drive.restrictions.adminManagedRestrictions,
              copyRequiresWriterPermission: drive.restrictions.copyRequiresWriterPermission,
              domainUsersOnly: drive.restrictions.domainUsersOnly,
              driveMembersOnly: drive.restrictions.driveMembersOnly,
            } : undefined,
            capabilities: drive.capabilities ? {
              canAddChildren: drive.capabilities.canAddChildren,
              canChangeCopyRequiresWriterPermissionRestriction: drive.capabilities.canChangeCopyRequiresWriterPermissionRestriction,
              canChangeDomainUsersOnlyRestriction: drive.capabilities.canChangeDomainUsersOnlyRestriction,
              canChangeDriveMembersOnlyRestriction: drive.capabilities.canChangeDriveMembersOnlyRestriction,
              canChangeSharingFoldersRequireOrganizerPermissionRestriction: drive.capabilities.canChangeSharingFoldersRequireOrganizerPermissionRestriction,
              canComment: drive.capabilities.canComment,
              canCopy: drive.capabilities.canCopy,
              canDeleteChildren: drive.capabilities.canDeleteChildren,
              canDeleteDrive: drive.capabilities.canDeleteDrive,
              canDownload: drive.capabilities.canDownload,
              canEdit: drive.capabilities.canEdit,
              canListChildren: drive.capabilities.canListChildren,
              canManageMembers: drive.capabilities.canManageMembers,
              canReadRevisions: drive.capabilities.canReadRevisions,
              canRename: drive.capabilities.canRename,
              canRenameDrive: drive.capabilities.canRenameDrive,
              canShare: drive.capabilities.canShare,
              canTrashChildren: drive.capabilities.canTrashChildren,
            } : undefined,
          });
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return drives;
  }

  /**
   * Get permissions for a shared drive
   */
  async getSharedDrivePermissions(userEmail: string, driveId: string): Promise<SharedDrivePermission[]> {
    await this.initialize(userEmail);

    const permissions: SharedDrivePermission[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.withRetry(() =>
        this.drive.permissions.list({
          fileId: driveId,
          supportsAllDrives: true,
          useDomainAdminAccess: true,
          fields: 'nextPageToken, permissions(id, type, role, emailAddress, domain, displayName, deleted, permissionDetails)',
          pageSize: 100,
          pageToken,
        })
      );

      if (response.data.permissions) {
        for (const perm of response.data.permissions) {
          // Skip deleted permissions
          if (perm.deleted) continue;

          permissions.push({
            id: perm.id || '',
            type: (perm.type as 'user' | 'group' | 'domain' | 'anyone') || 'user',
            role: (perm.role as 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader') || 'reader',
            emailAddress: perm.emailAddress,
            domain: perm.domain,
            displayName: perm.displayName,
            deleted: perm.deleted,
          });
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return permissions;
  }

  /**
   * Add a user or group to a shared drive
   */
  async addSharedDrivePermission(
    userEmail: string,
    driveId: string,
    permission: {
      type: 'user' | 'group' | 'domain' | 'anyone';
      role: 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader';
      emailAddress?: string;
      domain?: string;
    }
  ): Promise<SharedDrivePermission> {
    await this.initialize(userEmail);

    const requestBody: any = {
      type: permission.type,
      role: permission.role,
    };

    if (permission.type === 'user' || permission.type === 'group') {
      if (!permission.emailAddress) {
        throw new Error('emailAddress is required for user or group permissions');
      }
      requestBody.emailAddress = permission.emailAddress;
    } else if (permission.type === 'domain') {
      if (!permission.domain) {
        throw new Error('domain is required for domain permissions');
      }
      requestBody.domain = permission.domain;
    }

    const response = await this.withRetry(() =>
      this.drive.permissions.create({
        fileId: driveId,
        supportsAllDrives: true,
        requestBody,
        sendNotificationEmail: false,
      })
    );

    return {
      id: response.data.id || '',
      type: (response.data.type as 'user' | 'group' | 'domain' | 'anyone') || permission.type,
      role: (response.data.role as 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader') || permission.role,
      emailAddress: response.data.emailAddress,
      domain: response.data.domain,
      displayName: response.data.displayName,
    };
  }

  /**
   * Remove a user or group from a shared drive
   */
  async removeSharedDrivePermission(userEmail: string, driveId: string, permissionId: string): Promise<void> {
    await this.initialize(userEmail);

    await this.withRetry(() =>
      this.drive.permissions.delete({
        fileId: driveId,
        permissionId,
        supportsAllDrives: true,
      })
    );
  }
}

export const sharedDriveService = new SharedDriveService();
