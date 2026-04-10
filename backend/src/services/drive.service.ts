import { WorkspaceService } from './workspace.service';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
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
  /**
   * Get all Drive files with optional filtering (optimized version)
   */
  async getAllFiles(
    userEmail: string,
    filter?: DriveFileFilter,
    maxResults: number = 1000,
    onProgress?: (processed: number, total?: number) => void
  ): Promise<DriveFile[]> {
    await this.initialize(userEmail);

    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    let totalProcessed = 0;
    const workspaceDomain = process.env.WORKSPACE_DOMAIN || '';

    do {
      // Build query
      let query = 'trashed=false';
      if (filter?.mimeType) {
        query += ` and mimeType='${filter.mimeType}'`;
      }
      if (filter?.nameContains) {
        query += ` and name contains '${filter.nameContains}'`;
      }

      // Include permissions in the initial API call to avoid N+1 queries
      const response = await this.withRetry(() =>
        this.drive.files.list({
          q: query,
          fields: 'nextPageToken, files(id, name, mimeType, owners, shared, permissions, webViewLink, webContentLink, thumbnailLink, modifiedTime, createdTime, size, description, starred, trashed, version, parents)',
          pageSize: 100,
          pageToken,
        })
      );

      if (response.data.files) {
        // Process files in parallel to improve performance
        const filePromises = response.data.files.map(async (file) => {
          // Use permissions from the API response instead of making separate calls
          const permissions = (file.permissions || []).map(perm => ({
            id: perm.id || '',
            type: perm.type || '',
            role: perm.role || '',
            emailAddress: perm.emailAddress || undefined,
            domain: perm.domain || undefined,
            displayName: perm.displayName || undefined,
          }));

          // Get file path (cached for performance)
          const parents = file.parents || [];
          const filePath = await this.getFilePathCached(userEmail, file.id!, parents.length > 0 ? parents : undefined);

          // Check external sharing if needed
          const externalDomains: string[] = [];
          const externalEmails: string[] = [];

          for (const perm of permissions) {
            if (perm.type === 'domain' && perm.domain) {
              if (perm.domain !== workspaceDomain) {
                externalDomains.push(perm.domain);
              }
            } else if ((perm.type === 'user' || perm.type === 'group') && perm.emailAddress) {
              const emailDomain = perm.emailAddress.split('@')[1];
              if (emailDomain !== workspaceDomain) {
                externalEmails.push(perm.emailAddress);
                if (!externalDomains.includes(emailDomain)) {
                  externalDomains.push(emailDomain);
                }
              }
            }
          }

          const driveFile: DriveFile = {
            id: file.id!,
            name: file.name || 'Untitled',
            mimeType: file.mimeType || '',
            owners: (file.owners || []).map(owner => ({
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
            path: filePath,
          };

          // Apply filters
          if (filter) {
            // Owner filter
            if (filter.owner && !driveFile.owners.some(o => o.emailAddress === filter.owner || o.emailAddress?.includes(filter.owner!))) {
              return null; // Skip this file
            }

            // Domain filter
            if (filter.domain && !externalDomains.includes(filter.domain)) {
              return null; // Skip this file
            }

            // Size filters
            if (filter.minSize && (!driveFile.size || parseInt(driveFile.size) < filter.minSize)) {
              return null; // Skip this file
            }
            if (filter.maxSize && (!driveFile.size || parseInt(driveFile.size) > filter.maxSize)) {
              return null; // Skip this file
            }

            // Date filters
            if (filter.createdAfter && driveFile.createdTime && new Date(driveFile.createdTime) < new Date(filter.createdAfter)) {
              return null; // Skip this file
            }
            if (filter.createdBefore && driveFile.createdTime && new Date(driveFile.createdTime) > new Date(filter.createdBefore)) {
              return null; // Skip this file
            }
            if (filter.modifiedAfter && new Date(driveFile.modifiedTime) < new Date(filter.modifiedAfter)) {
              return null; // Skip this file
            }
            if (filter.modifiedBefore && new Date(driveFile.modifiedTime) > new Date(filter.modifiedBefore)) {
              return null; // Skip this file
            }

            // Path filter
            if (filter.pathContains && !driveFile.path?.includes(filter.pathContains)) {
              return null; // Skip this file
            }

            // Shared filter
            if (filter.shared !== undefined && driveFile.shared !== filter.shared) {
              return null; // Skip this file
            }

            // External sharing filter
            if (filter.externallyShared !== undefined) {
              const hasExternal = externalDomains.length > 0 || externalEmails.length > 0;
              if (filter.externallyShared !== hasExternal) {
                return null; // Skip this file
              }
            }
          }

          return driveFile;
        });

        // Wait for all files in this batch to be processed
        const batchResults = await Promise.all(filePromises);

        // Filter out null results (skipped files) and add to results
        const validFiles = batchResults.filter((file): file is DriveFile => file !== null);
        files.push(...validFiles);

        totalProcessed += validFiles.length;
        onProgress?.(totalProcessed);

        // Stop if we've reached the max results
        if (files.length >= maxResults) {
          files.splice(maxResults); // Trim to max results
          break;
        }
      }

      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return files;
  }

  /**
   * Stream all Drive files with batch processing (for large exports)
   */
  async streamAllFiles(
    userEmail: string,
    filter?: DriveFileFilter,
    maxResults: number = 10000,
    onBatch?: (files: DriveFile[]) => boolean // Return false to stop processing
  ): Promise<void> {
    await this.initialize(userEmail);

    let pageToken: string | undefined;
    let totalProcessed = 0;
    const batchSize = 50; // Smaller batches for streaming

    do {
      // Build query
      let query = 'trashed=false';
      if (filter?.mimeType) {
        query += ` and mimeType='${filter.mimeType}'`;
      }
      if (filter?.nameContains) {
        query += ` and name contains '${filter.nameContains}'`;
      }

      const response = await this.withRetry(() =>
        this.drive.files.list({
          q: query,
          fields: 'nextPageToken, files(id, name, mimeType, owners, shared, permissions, webViewLink, webContentLink, thumbnailLink, modifiedTime, createdTime, size, description, starred, trashed, version, parents)',
          pageSize: batchSize,
          pageToken,
        })
      );

      if (response.data.files && response.data.files.length > 0) {
        // Process files in parallel
        const filePromises = response.data.files.map(async (file) => {
          const permissions = (file.permissions || []).map(perm => ({
            id: perm.id || '',
            type: perm.type || '',
            role: perm.role || '',
            emailAddress: perm.emailAddress || undefined,
            domain: perm.domain || undefined,
            displayName: perm.displayName || undefined,
          }));

          const parents = file.parents || [];
          const filePath = await this.getFilePathCached(userEmail, file.id!, parents.length > 0 ? parents : undefined);

          const driveFile: DriveFile = {
            id: file.id!,
            name: file.name || 'Untitled',
            mimeType: file.mimeType || '',
            owners: (file.owners || []).map(owner => ({
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
            path: filePath,
          };

          // Apply filters
          if (filter) {
            if (filter.owner && !driveFile.owners.some(o => o.emailAddress === filter.owner || o.emailAddress?.includes(filter.owner!))) {
              return null;
            }
            if (filter.domain) {
              const externalDomains = driveFile.permissions
                .filter(p => p.type === 'domain' && p.domain)
                .map(p => p.domain!);
              if (!externalDomains.includes(filter.domain)) {
                return null;
              }
            }
            // Add other filters as needed...
          }

          return driveFile;
        });

        const batchResults = await Promise.all(filePromises);
        const validFiles = batchResults.filter((file): file is DriveFile => file !== null);

        if (validFiles.length > 0) {
          // Call the callback with this batch
          const shouldContinue = onBatch ? onBatch(validFiles) : true;
          if (!shouldContinue) {
            break; // Client disconnected or wants to stop
          }

          totalProcessed += validFiles.length;

          // Stop if we've reached the max results
          if (totalProcessed >= maxResults) {
            break;
          }
        }

        pageToken = response.data.nextPageToken;
      } else {
        break;
      }
    } while (pageToken);
  }

  /**
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
            path: filePath,
          };

          // Apply filters
          if (filter) {
            // Owner filter
            if (filter.owner && !driveFile.owners.some(o => o.emailAddress === filter.owner || o.emailAddress?.includes(filter.owner!))) {
              continue;
            }

            // Size filters
            if (filter.minSize && (!driveFile.size || parseInt(driveFile.size) < filter.minSize)) {
              continue;
            }
            if (filter.maxSize && (!driveFile.size || parseInt(driveFile.size) > filter.maxSize)) {
              continue;
            }

            // Date filters
            if (filter.createdAfter && (!driveFile.createdTime || new Date(driveFile.createdTime) < new Date(filter.createdAfter))) {
              continue;
            }
            if (filter.createdBefore && (!driveFile.createdTime || new Date(driveFile.createdTime) > new Date(filter.createdBefore))) {
              continue;
            }
            if (filter.modifiedAfter && (!driveFile.modifiedTime || new Date(driveFile.modifiedTime) < new Date(filter.modifiedAfter))) {
              continue;
            }
            if (filter.modifiedBefore && (!driveFile.modifiedTime || new Date(driveFile.modifiedTime) > new Date(filter.modifiedBefore))) {
              continue;
            }

            // Path filter
            if (filter.pathContains && (!driveFile.path || !driveFile.path.toLowerCase().includes(filter.pathContains.toLowerCase()))) {
              continue;
            }

            // Shared filter
            if (filter.shared !== undefined && driveFile.shared !== filter.shared) {
              continue;
            }

            // External sharing filter
            if (filter.externallyShared !== undefined) {
              const hasExternalSharing = externalDomains.length > 0 || externalEmails.length > 0;
              if (hasExternalSharing !== filter.externallyShared) {
                continue;
              }
            }

            // Domain filter (for external sharing)
            if (filter.domain) {
              if (!externalDomains.includes(filter.domain) && !externalEmails.some(e => e.split('@')[1] === filter.domain)) {
                continue;
              }
            }
          }

          files.push(driveFile);

          if (files.length >= maxResults) {
            break;
          }
        }
      }

      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken && files.length < maxResults);

    return files;
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

    const reports: ExternalSharingReport[] = [];
    let pageToken: string | undefined;
    let totalProcessed = 0;
    const workspaceDomain = process.env.WORKSPACE_DOMAIN || '';

    do {
      const response = await this.withRetry(() =>
        this.drive.files.list({
          q: 'trashed=false',
          fields: 'nextPageToken, files(id, name, mimeType, owners, shared, permissions, webViewLink, webContentLink, thumbnailLink, modifiedTime, createdTime, size, description, starred, trashed, version, parents)',
          pageSize: 100,
          pageToken,
        })
      );

      if (response.data.files) {
        // Process files in parallel for better performance
        const filePromises = response.data.files.map(async (file) => {
          // Use permissions from API response instead of separate calls
          const permissions = (file.permissions || []).map(perm => ({
            id: perm.id || '',
            type: perm.type || '',
            role: perm.role || '',
            emailAddress: perm.emailAddress || undefined,
            domain: perm.domain || undefined,
            displayName: perm.displayName || undefined,
          }));

          // Get file path (cached)
          const parents = file.parents || [];
          const filePath = await this.getFilePathCached(userEmail, file.id!, parents.length > 0 ? parents : undefined);
          
          // Check for external sharing
          const externalDomains: string[] = [];
          const externalEmails: string[] = [];

          for (const perm of permissions) {
            if (perm.type === 'domain' && perm.domain) {
              if (perm.domain !== workspaceDomain && (!domain || perm.domain === domain)) {
                externalDomains.push(perm.domain);
              }
            } else if ((perm.type === 'user' || perm.type === 'group') && perm.emailAddress) {
              const emailDomain = perm.emailAddress.split('@')[1];
              if (emailDomain !== workspaceDomain && (!domain || emailDomain === domain)) {
                externalEmails.push(perm.emailAddress);
                if (!externalDomains.includes(emailDomain)) {
                  externalDomains.push(emailDomain);
                }
              }
            }
          }

          if (externalDomains.length > 0 || externalEmails.length > 0) {
            const driveFile: DriveFile = {
              id: file.id!,
              name: file.name || 'Untitled',
              mimeType: file.mimeType || '',
              owners: (file.owners || []).map(owner => ({
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
              path: filePath,
            };

            return {
              file: driveFile,
              externalDomains,
              externalEmails,
            };
          }

          return null; // No external sharing for this file
        });

        // Wait for all files in this batch to be processed
        const batchResults = await Promise.all(filePromises);

        // Filter out null results and add to reports
        const validReports = batchResults.filter((result): result is ExternalSharingReport => result !== null);
        reports.push(...validReports);

        totalProcessed += validReports.length;
        onProgress?.(totalProcessed);

        pageToken = response.data.nextPageToken;
      } else {
        break;
      }
    } while (pageToken);

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
        try {
          const parentResponse = await this.drive.files.get({
            fileId: currentParentId,
            fields: 'id, name, parents, driveId',
            supportsAllDrives: true,
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
      return isSharedDriveRoot ? `/${pathStr}` : `/My Drive/${pathStr}`;
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
          fields: 'permissions(id, type, role, emailAddress, domain, displayName)',
        })
      );

      return (response.data.permissions || []).map(perm => ({
        id: perm.id || '',
        type: perm.type || '',
        role: perm.role || '',
        emailAddress: perm.emailAddress,
        domain: perm.domain,
        displayName: perm.displayName,
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
          fields: 'id, name, mimeType, owners, shared, webViewLink, webContentLink, thumbnailLink, modifiedTime, createdTime, size, description, starred, trashed, version, parents',
        })
      );

      const permissions = await this.getFilePermissions(userEmail, fileId);
      const filePath = await this.getFilePath(userEmail, fileId, fileResponse.data.parents);

      return {
        id: fileResponse.data.id!,
        name: fileResponse.data.name || 'Untitled',
        mimeType: fileResponse.data.mimeType || '',
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
        path: filePath,
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
          includePermissionsForView: 'published',
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
