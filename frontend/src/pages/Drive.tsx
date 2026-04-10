import { useEffect, useState, useRef, useMemo } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  LinearProgress,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Select,
  FormControl,
  IconButton,
  Button,
  Tooltip,
  Grid,
  Popover,
  Checkbox,
  Alert,
  Snackbar,
  TablePagination,
  Link,
  Divider,
  useMediaQuery,
  InputAdornment,
} from '@mui/material';
import {
  Search,
  Trash2,
  Pencil,
  ListFilter,
  X,
  Ban,
  RefreshCw,
  Calendar,
  ExternalLink,
  Plus,
  Check,
} from 'lucide-react';
import { apiClient } from '../services/api.client';
import { ExportButton } from '../components/ExportButton';
import { DateRangeCalendar } from '../components/DateRangeCalendar';
import { isDemoMode, driveFiles as DEMO_FILES, externalSharingReports, externalSharingStatistics } from '../data/demoData';
import { T, pick, selectMenuProps, textSecondary, textTertiary, exportToolbarButtonSx } from '../theme/designTokens';
import { tablePaginationProps } from '../components/ui/tablePaginationProps';
import { ColumnHeader } from '../components/ui/ColumnHeader';
import { ListShell, ListHeaderRow, ListDataRow } from '../components/ui/ListShell';
import { DialogListPagination, DIALOG_LIST_PAGE_SIZE } from '../components/ui/DialogListPagination';
import { DIALOG_LIST_SORT, dialogListNoopSort } from '../components/ui/dialogListSort';
import { DotLabel } from '../components/StatusDot';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { FilterToken } from '../components/ui/FilterToken';
import { useTheme } from '@mui/material/styles';

const DRIVE_STATIC_SORT = { key: '_', direction: 'asc' as const };
const driveNoopSort = () => {};

interface DriveFile {
  id: string;
  name: string;
  webViewLink: string;
  modifiedTime: string;
  createdTime?: string;
  owners: Array<{ emailAddress: string; displayName: string }>;
  mimeType: string;
  size?: string;
  path?: string;
  shared: boolean;
  permissions: Array<{
    id: string;
    type: string;
    role: string;
    emailAddress?: string;
    domain?: string;
    displayName?: string;
  }>;
}

interface DriveFilters {
  owner: string;
  mimeType: string;
  minSize: string;
  maxSize: string;
  createdFrom: string;
  createdTo: string;
  modifiedFrom: string;
  modifiedTo: string;
  pathContains: string;
  nameContains: string;
  shared: string;
  externallyShared: string;
  domain: string;
}

// Google Drive and common file MIME types for filter dropdown
const DRIVE_MIME_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '' },
  { value: 'application/vnd.google-apps.document', label: 'Google Docs' },
  { value: 'application/vnd.google-apps.spreadsheet', label: 'Google Sheets' },
  { value: 'application/vnd.google-apps.presentation', label: 'Google Slides' },
  { value: 'application/vnd.google-apps.drawing', label: 'Google Drawings' },
  { value: 'application/vnd.google-apps.form', label: 'Google Forms' },
  { value: 'application/vnd.google-apps.folder', label: 'Folder' },
  { value: 'application/vnd.google-apps.shortcut', label: 'Shortcut' },
  { value: 'application/vnd.google-apps.site', label: 'Google Sites' },
  { value: 'application/vnd.google-apps.script', label: 'Apps Script' },
  { value: 'application/vnd.google-apps.jam', label: 'Jamboard' },
  { value: 'application/vnd.google-apps.map', label: 'Google My Maps' },
  { value: 'application/vnd.google-apps.file', label: 'Google Drive file' },
  { value: 'application/vnd.google-apps.photo', label: 'Google Photos' },
  { value: 'application/vnd.google-apps.audio', label: 'Audio' },
  { value: 'application/vnd.google-apps.video', label: 'Video' },
  { value: 'application/vnd.google-apps.unknown', label: 'Unknown' },
  { value: 'application/pdf', label: 'PDF' },
  { value: 'text/plain', label: 'Plain text' },
  { value: 'text/csv', label: 'CSV' },
  { value: 'image/jpeg', label: 'JPEG image' },
  { value: 'image/png', label: 'PNG image' },
  { value: 'image/gif', label: 'GIF image' },
  { value: 'image/webp', label: 'WebP image' },
  { value: 'video/mp4', label: 'MP4 video' },
  { value: 'video/webm', label: 'WebM video' },
  { value: 'application/zip', label: 'ZIP archive' },
  { value: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word (.docx)' },
  { value: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel (.xlsx)' },
  { value: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint (.pptx)' },
];

// Google Drive file permission roles (My Drive / file-level). API values → UI labels.
const FILE_PERMISSION_ROLES: { value: string; label: string }[] = [
  { value: 'reader', label: 'Viewer' },
  { value: 'commenter', label: 'Commenter' },
  { value: 'writer', label: 'Editor' },
];
const FILE_ROLE_LABEL: Record<string, string> = Object.fromEntries(FILE_PERMISSION_ROLES.map((r) => [r.value, r.label]));

// Owner is not editable; show as-is.
const getFileRoleLabel = (role: string) => (role === 'owner' ? 'Owner' : FILE_ROLE_LABEL[role] || role);

const WORKSPACE_DOMAIN = (import.meta as unknown as { env?: { VITE_WORKSPACE_DOMAIN?: string } }).env?.VITE_WORKSPACE_DOMAIN || 'example.com';
function isPermissionExternal(perm: { type: string; domain?: string; emailAddress?: string }): boolean {
  if (perm.type === 'anyone') return true;
  if (perm.type === 'domain' && perm.domain) return perm.domain.toLowerCase() !== WORKSPACE_DOMAIN.toLowerCase();
  if ((perm.type === 'user' || perm.type === 'group') && perm.emailAddress) {
    const domain = perm.emailAddress.split('@')[1]?.toLowerCase();
    return !!domain && domain !== WORKSPACE_DOMAIN.toLowerCase();
  }
  return false;
}

export function Drive() {
  const muiTheme = useTheme();
  const isMdUp = useMediaQuery(muiTheme.breakpoints.up('md'));
  const dialogPaperSx = {
    fontFamily: T.font,
    bgcolor: pick(muiTheme, T.surface, '#18181b'),
    backgroundImage: 'none',
    border: `1px solid ${pick(muiTheme, T.border, '#3f3f46')}`,
    borderRadius: T.radiusLg,
    '& .MuiDialogContent-root': { pt: 0 },
    '& .MuiTypography-root, & .MuiInputBase-root': { fontFamily: T.font },
  };
  const [tabValue, setTabValue] = useState(0);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [externalSharingData, setExternalSharingData] = useState<any>(null);
  const [externalSharingLoading, setExternalSharingLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [filters, setFilters] = useState<DriveFilters>({
    owner: '',
    mimeType: '',
    minSize: '',
    maxSize: '',
    createdFrom: '',
    createdTo: '',
    modifiedFrom: '',
    modifiedTo: '',
    pathContains: '',
    nameContains: '',
    shared: '',
    externallyShared: '',
    domain: '',
  });
  const [externalSearchTerm, setExternalSearchTerm] = useState('');
  const [filtersVisible, setFiltersVisible] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const exportCSVRef = useRef<() => void | Promise<void>>(() => {});
  const exportSelectedCSVRef = useRef<() => void | Promise<void>>(() => {});
  const exportExternalSharingRef = useRef<() => void | Promise<void>>(() => {});
  const exportExternalSelectedCSVRef = useRef<() => void | Promise<void>>(() => {});
  const [createdDateAnchor, setCreatedDateAnchor] = useState<HTMLElement | null>(null);
  const [modifiedDateAnchor, setModifiedDateAnchor] = useState<HTMLElement | null>(null);
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const [selectedPermission, setSelectedPermission] = useState<any>(null);
  const [newRole, setNewRole] = useState<string>('reader');
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<Set<string>>(new Set());
  const [addPermissionDialogOpen, setAddPermissionDialogOpen] = useState(false);
  const [newPermissionType, setNewPermissionType] = useState<'user' | 'domain' | 'anyone'>('user');
  const [newPermissionRole, setNewPermissionRole] = useState<'reader' | 'commenter' | 'writer'>('reader');
  const [newPermissionEmail, setNewPermissionEmail] = useState('');
  const [newPermissionDomain, setNewPermissionDomain] = useState('');
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' | 'warning' }>({
    open: false,
    message: '',
    severity: 'success',
  });
  const [filePermissionsPage, setFilePermissionsPage] = useState(0);
  const [filePermissionsRowsPerPage, setFilePermissionsRowsPerPage] = useState(DIALOG_LIST_PAGE_SIZE);

  useEffect(() => {
    if (!permissionDialogOpen) return;
    setFilePermissionsPage(0);
  }, [permissionDialogOpen, selectedFile?.id]);

  useEffect(() => {
    const n = selectedFile?.permissions?.length ?? 0;
    const max = Math.max(0, Math.ceil(n / filePermissionsRowsPerPage) - 1);
    setFilePermissionsPage((p) => Math.min(p, max));
  }, [selectedFile?.permissions?.length, selectedFile?.id, filePermissionsRowsPerPage]);

  useEffect(() => {
    if (tabValue === 0) {
      // External Shares tab: fetch external sharing data
      fetchExternalSharing();
    } else if (tabValue === 1) {
      // All Files tab: fetch files when empty
      if (files.length === 0) {
        fetchFiles();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabValue]);

  useEffect(() => {
    // Reset to first page when filters change
    setPage(0);
  }, [filters]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setFiltersVisible((v) => !v);
      }
      if (tabValue === 0) {
        // External Shares tab
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
          e.preventDefault();
          e.stopPropagation();
          const fn = selectedFiles.size > 0 ? exportExternalSelectedCSVRef.current : exportExternalSharingRef.current;
          if (typeof fn === 'function') fn();
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
          e.preventDefault();
          handleExportExternalSharingDrive();
        }
      }
      if (tabValue === 1) {
        // All Files tab
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
          e.preventDefault();
          e.stopPropagation();
          const fn = selectedFiles.size > 0 ? exportSelectedCSVRef.current : exportCSVRef.current;
          if (typeof fn === 'function') fn();
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
          e.preventDefault();
          if (selectedFiles.size > 0) handleExportSelectedDrive();
          else if (hasActiveFilters()) handleExportAllDrive();
          else handleExportAllDrive();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [tabValue, selectedFiles.size]);

  const fetchExternalSharing = async () => {
    try {
      setExternalSharingLoading(true);
      const response = await apiClient.get('/audit/external-sharing');
      setExternalSharingData(response.data);
    } catch (error) {
      console.error('Error fetching external sharing audit:', error);
      // In demo mode, use central demo data
      if (isDemoMode()) {
        setExternalSharingData({
          reports: externalSharingReports,
          statistics: externalSharingStatistics,
        });
      }
    } finally {
      setExternalSharingLoading(false);
    }
  };

  const buildQueryParams = () => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value.trim() !== '') {
        params.append(key, value.trim());
      }
    });
    return params.toString();
  };

  /** Derive location label from file path: "My Drive" or shared drive name */
  const getFileLocationLabel = (file: DriveFile): string => {
    const path = file.path?.trim() || '/My Drive';
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return 'My Drive';
    if (segments[0] === 'My Drive') return 'My Drive';
    if (segments[0] === 'Shared Drive' && segments.length > 1) return segments[1];
    return segments[0];
  };

  const getExternalSharingInfo = (file: DriveFile) => {
    const externalDomains: string[] = [];
    const externalEmails: string[] = [];
    
    file.permissions.forEach(perm => {
      if (perm.type === 'domain' && perm.domain) {
        externalDomains.push(perm.domain);
      } else if (perm.type === 'user' && perm.emailAddress) {
        const emailDomain = perm.emailAddress.split('@')[1];
        externalEmails.push(perm.emailAddress);
        if (!externalDomains.includes(emailDomain)) {
          externalDomains.push(emailDomain);
        }
      }
    });
    
    return { externalDomains, externalEmails };
  };

  const applyFiltersToFiles = (filesToFilter: DriveFile[]): DriveFile[] => {
    return filesToFilter.filter(file => {
      // Name contains filter
      if (filters.nameContains && !file.name.toLowerCase().includes(filters.nameContains.toLowerCase())) {
        return false;
      }

      // Owner filter
      if (filters.owner) {
        const ownerEmails = file.owners.map(o => o.emailAddress.toLowerCase());
        if (!ownerEmails.some(email => email.includes(filters.owner.toLowerCase()))) {
          return false;
        }
      }

      // MIME type filter
      if (filters.mimeType && !file.mimeType.toLowerCase().includes(filters.mimeType.toLowerCase())) {
        return false;
      }

      // Path contains filter
      if (filters.pathContains && file.path && !file.path.toLowerCase().includes(filters.pathContains.toLowerCase())) {
        return false;
      }

      // Size filters
      if (filters.minSize) {
        const minSize = parseInt(filters.minSize);
        const fileSize = parseInt(file.size || '0');
        if (fileSize < minSize) {
          return false;
        }
      }
      if (filters.maxSize) {
        const maxSize = parseInt(filters.maxSize);
        const fileSize = parseInt(file.size || '0');
        if (fileSize > maxSize) {
          return false;
        }
      }

      // Created date filter (single or range via from/to)
      if ((filters.createdFrom || filters.createdTo) && file.createdTime) {
        const startStr = filters.createdFrom || filters.createdTo;
        const endStr = filters.createdTo || filters.createdFrom;
        const start = new Date(startStr); start.setHours(0, 0, 0, 0);
        const end = new Date(endStr); end.setHours(23, 59, 59, 999);
        const t = new Date(file.createdTime);
        if (t < start || t > end) return false;
      }
      // Modified date filter (single or range via from/to)
      if ((filters.modifiedFrom || filters.modifiedTo) && file.modifiedTime) {
        const startStr = filters.modifiedFrom || filters.modifiedTo;
        const endStr = filters.modifiedTo || filters.modifiedFrom;
        const start = new Date(startStr); start.setHours(0, 0, 0, 0);
        const end = new Date(endStr); end.setHours(23, 59, 59, 999);
        const t = new Date(file.modifiedTime);
        if (t < start || t > end) return false;
      }

      // Shared filter
      if (filters.shared !== '') {
        const isShared = filters.shared === 'true';
        if (file.shared !== isShared) {
          return false;
        }
      }

      // External sharing filter
      if (filters.externallyShared !== '') {
        const { externalDomains, externalEmails } = getExternalSharingInfo(file);
        const hasExternalSharing = externalDomains.length > 0 || externalEmails.length > 0;
        const shouldHaveExternal = filters.externallyShared === 'true';
        if (hasExternalSharing !== shouldHaveExternal) {
          return false;
        }
      }

      // Domain filter
      if (filters.domain) {
        const { externalDomains } = getExternalSharingInfo(file);
        const domainLower = filters.domain.toLowerCase();
        if (!externalDomains.some(d => d.toLowerCase().includes(domainLower))) {
          return false;
        }
      }

      return true;
    });
  };

  const filteredExternalReports = useMemo(() => {
    const reports = externalSharingData?.reports ?? [];
    if (!externalSearchTerm.trim()) return reports;
    const term = externalSearchTerm.toLowerCase().trim();
    return reports.filter((report: any) => {
      const name = (report.file?.name ?? '').toLowerCase();
      const domains = (report.externalDomains ?? []).join(' ').toLowerCase();
      const emails = (report.externalEmails ?? []).join(' ').toLowerCase();
      return name.includes(term) || domains.includes(term) || emails.includes(term);
    });
  }, [externalSharingData, externalSearchTerm]);

  useEffect(() => {
    setPage(0);
  }, [externalSearchTerm]);

  const fetchFiles = async () => {
    try {
      setLoading(true);
      const queryParams = buildQueryParams();
      const url = queryParams ? `/drive/files?${queryParams}` : '/drive/files';
      const response = await apiClient.get(url);
      setFiles(response.data);
    } catch (error) {
      console.error('Error fetching files:', error);
      // In demo mode, show sample data (same DEMO_FILES as External Shares Permissions dialog)
      if (isDemoMode()) {
        const filteredFiles = applyFiltersToFiles(DEMO_FILES as DriveFile[]);
        setFiles(filteredFiles);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (key: keyof DriveFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({
      owner: '',
      mimeType: '',
      minSize: '',
      maxSize: '',
      createdFrom: '',
      createdTo: '',
      modifiedFrom: '',
      modifiedTo: '',
      pathContains: '',
      nameContains: '',
      shared: '',
      externallyShared: '',
      domain: '',
    });
  };

  const hasActiveFilters = () => {
    return Object.values(filters).some(v => v && v.trim() !== '');
  };

  const handleSelectAll = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      setSelectedFiles(new Set(files.map(f => f.id)));
    } else {
      setSelectedFiles(new Set());
    }
  };

  const handleSelectFile = (fileId: string) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(fileId)) {
      newSelected.delete(fileId);
    } else {
      newSelected.add(fileId);
    }
    setSelectedFiles(newSelected);
  };

  const paginatedExternalReports = useMemo(() => {
    const start = page * rowsPerPage;
    return filteredExternalReports.slice(start, start + rowsPerPage);
  }, [filteredExternalReports, page, rowsPerPage]);

  const handleSelectAllExternal = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      setSelectedFiles(new Set(paginatedExternalReports.map((r: any) => r.file?.id).filter(Boolean)));
    } else {
      setSelectedFiles(new Set());
    }
  };

  const handleOpenPermissionDialogForReport = async (report: any) => {
    const f = report.file ?? {};
    const fileId = f.id;
    if (!fileId) return;

    // In demo mode, use the same file (with full permissions) as All Files so dialog matches
    if (isDemoMode()) {
      const fileWithPermissions = (DEMO_FILES as DriveFile[]).find((file) => file.id === fileId) ?? files.find((file) => file.id === fileId);
      if (fileWithPermissions) {
        setSelectedFile(fileWithPermissions);
        setSelectedPermission(null);
        setPermissionDialogOpen(true);
        return;
      }
      // Fallback if file id not in demo list: build from report with synthetic permissions
      const domains = report.externalDomains ?? [];
      const emails = report.externalEmails ?? [];
      const permissions = [
        ...domains.map((d: string, i: number) => ({ id: `ext-domain-${i}`, type: 'domain' as const, role: 'reader', domain: d })),
        ...emails.map((e: string, i: number) => ({ id: `ext-user-${i}`, type: 'user' as const, role: 'reader', emailAddress: e })),
      ];
      const file: DriveFile = {
        id: fileId,
        name: f.name ?? '',
        mimeType: f.mimeType ?? '',
        path: f.path ?? '/My Drive',
        owners: Array.isArray(f.owners) ? f.owners : [],
        permissions,
        webViewLink: f.webViewLink ?? '',
        modifiedTime: f.modifiedTime ?? '',
        createdTime: f.createdTime ?? '',
        size: f.size,
        shared: true,
      };
      setSelectedFile(file);
      setSelectedPermission(null);
      setPermissionDialogOpen(true);
      return;
    }

    try {
      const response = await apiClient.get(`/drive/files/${fileId}`);
      const data = response.data;
      const file: DriveFile = {
        id: data.id,
        name: data.name ?? '',
        mimeType: data.mimeType ?? '',
        path: data.path ?? '/My Drive',
        owners: Array.isArray(data.owners) ? data.owners : [],
        permissions: Array.isArray(data.permissions) ? data.permissions : [],
        webViewLink: data.webViewLink ?? '',
        modifiedTime: data.modifiedTime ?? '',
        createdTime: data.createdTime ?? '',
        size: data.size,
        shared: data.shared ?? false,
      };
      setSelectedFile(file);
      setSelectedPermission(null);
      setPermissionDialogOpen(true);
    } catch (err: any) {
      console.error(err);
      alert(err?.response?.data?.error || 'Failed to load file for permissions.');
    }
  };

  const handleBulkRemoveExternalShares = async () => {
    if (selectedFiles.size === 0) return;

    if (!confirm(`Are you sure you want to remove all external shares from ${selectedFiles.size} file(s)?`)) {
      return;
    }

    try {
      setBulkActionLoading(true);
      const response = await apiClient.post('/drive/files/bulk-remove-external-shares', {
        fileIds: Array.from(selectedFiles),
      });

      const { success, failed } = response.data;
      
      // Refresh files to show updated permissions
      await fetchFiles();
      
      // Clear selection
      setSelectedFiles(new Set());

      if (failed === 0) {
        setSnackbar({
          open: true,
          message: `Successfully removed external shares from ${success} file(s)`,
          severity: 'success',
        });
      } else {
        setSnackbar({
          open: true,
          message: `Removed external shares from ${success} file(s), ${failed} failed`,
          severity: 'warning',
        });
      }
    } catch (error: any) {
      console.error('Error removing external shares:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.error || 'Failed to remove external shares',
        severity: 'error',
      });
    } finally {
      setBulkActionLoading(false);
    }
  };

  /** Build CSV from current files (used for demo fallback and selected export) */
  const buildFilesCSV = (filesToExport: DriveFile[]) => {
    const workspaceDomain = '';
    const csvData = filesToExport.map((file) => {
      const externalDomains: string[] = [];
      const externalEmails: string[] = [];
      for (const perm of file.permissions || []) {
        if (perm.type === 'domain' && perm.domain && perm.domain !== workspaceDomain) externalDomains.push(perm.domain);
        else if (perm.type === 'user' && perm.emailAddress) {
          const emailDomain = perm.emailAddress.split('@')[1];
          if (emailDomain !== workspaceDomain) {
            externalEmails.push(perm.emailAddress);
            if (!externalDomains.includes(emailDomain)) externalDomains.push(emailDomain);
          }
        }
      }
      return {
        'File Name': file.name,
        'File ID': file.id,
        'File Path': file.path || '/My Drive',
        'File Type': file.mimeType,
        'Owner': file.owners?.map((o: any) => o.emailAddress).join('; ') || '',
        'Created Date': file.createdTime ? new Date(file.createdTime).toISOString() : '',
        'Modified Date': file.modifiedTime ? new Date(file.modifiedTime).toISOString() : '',
        'Size (bytes)': file.size || '',
        'Shared': file.shared ? 'Yes' : 'No',
        'External Domains': externalDomains.join('; '),
        'External Emails': externalEmails.join('; '),
        'Link': file.webViewLink,
      };
    });
    const headers = Object.keys(csvData[0] || {});
    return [
      headers.join(','),
      ...csvData.map((row) =>
        headers
          .map((h) => {
            const v = row[h as keyof typeof row];
            const s = v === null || v === undefined ? '' : String(v);
            return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(',')
      ),
    ].join('\n');
  };

  const handleExportCSV = async () => {
    try {
      const queryParams = buildQueryParams();
      const url = queryParams ? `/drive/files/export?${queryParams}` : '/drive/files/export';
      const response = await apiClient.get(url, { responseType: 'blob' });

      const blob = new Blob([response.data], { type: 'text/csv' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `drive-files-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      setSnackbar({ open: true, message: 'CSV downloading now.', severity: 'success' });
    } catch (error) {
      // In demo mode (or when API returns 401), export current page data as CSV
      if (isDemoMode() && files.length > 0) {
        const csv = buildFilesCSV(files);
        const blob = new Blob([csv], { type: 'text/csv' });
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `drive-files-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
        setSnackbar({ open: true, message: 'CSV downloading now.', severity: 'success' });
        return;
      }
      console.error('Error exporting CSV:', error);
      setSnackbar({ open: true, message: 'Export failed. Please try again.', severity: 'error' });
    }
  };

  const handleOpenPermissionDialog = (file: DriveFile, permission?: any) => {
    setSelectedFile(file);
    setSelectedPermission(permission || null);
    if (permission) {
      setNewRole(permission.role);
    }
    setPermissionDialogOpen(true);
  };

  const handleUpdatePermission = async () => {
    if (!selectedFile || !selectedPermission) return;

    try {
      await apiClient.patch(
        `/drive/files/${selectedFile.id}/permissions/${selectedPermission.id}`,
        { role: newRole }
      );
      if (tabValue === 0) fetchExternalSharing(); else fetchFiles();
      setPermissionDialogOpen(false);
    } catch (error) {
      console.error('Error updating permission:', error);
      alert('Failed to update permission. Please try again.');
    }
  };

  const handleDeletePermission = async (fileId: string, permissionId: string) => {
    if (!confirm('Are you sure you want to remove this permission?')) return;

    try {
      await apiClient.delete(`/drive/files/${fileId}/permissions/${permissionId}`);
      setSelectedFile((prev) =>
        prev && prev.id === fileId ? { ...prev, permissions: (prev.permissions ?? []).filter((p) => p.id !== permissionId) } : prev
      );
      setSelectedPermissionIds((prev) => {
        const next = new Set(prev);
        next.delete(permissionId);
        return next;
      });
      if (tabValue === 0) fetchExternalSharing();
      else fetchFiles();
    } catch (error) {
      console.error('Error deleting permission:', error);
      alert('Failed to delete permission. Please try again.');
    }
  };

  const refreshSelectedFilePermissions = async () => {
    if (!selectedFile?.id) return;
    try {
      const { data } = await apiClient.get<DriveFile['permissions']>(`/drive/files/${selectedFile.id}/permissions`);
      setSelectedFile((prev) => (prev && prev.id === selectedFile.id ? { ...prev, permissions: data ?? [] } : prev));
    } catch (err) {
      console.error('Error refreshing permissions:', err);
    }
  };

  const handleAddFilePermission = async () => {
    if (!selectedFile) return;
    if (newPermissionType === 'user' && !newPermissionEmail.trim()) {
      setSnackbar({ open: true, message: 'Enter an email for user permission', severity: 'warning' });
      return;
    }
    if (newPermissionType === 'domain' && !newPermissionDomain.trim()) {
      setSnackbar({ open: true, message: 'Enter a domain for domain permission', severity: 'warning' });
      return;
    }
    try {
      await apiClient.post(`/drive/files/${selectedFile.id}/permissions`, {
        type: newPermissionType,
        role: newPermissionRole,
        ...(newPermissionType === 'user' && { emailAddress: newPermissionEmail.trim() }),
        ...(newPermissionType === 'domain' && { domain: newPermissionDomain.trim() }),
      });
      await refreshSelectedFilePermissions();
      setAddPermissionDialogOpen(false);
      setNewPermissionEmail('');
      setNewPermissionDomain('');
      setSnackbar({ open: true, message: 'Permission added successfully', severity: 'success' });
      if (tabValue === 0) fetchExternalSharing();
      else fetchFiles();
    } catch (error: any) {
      console.error('Error adding permission:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.error || 'Failed to add permission',
        severity: 'error',
      });
    }
  };

  const handleBulkRemovePermissions = async () => {
    if (!selectedFile || selectedPermissionIds.size === 0) return;
    const perms = (selectedFile.permissions ?? []).filter((p) => selectedPermissionIds.has(p.id) && p.role !== 'owner');
    if (perms.length === 0) return;
    if (!confirm(`Remove ${perms.length} permission(s)?`)) return;
    try {
      for (const p of perms) {
        await apiClient.delete(`/drive/files/${selectedFile.id}/permissions/${p.id}`);
      }
      setSelectedFile((prev) =>
        prev && prev.id === selectedFile.id
          ? { ...prev, permissions: (prev.permissions ?? []).filter((p) => !selectedPermissionIds.has(p.id)) }
          : prev
      );
      setSelectedPermissionIds(new Set());
      setSnackbar({ open: true, message: `${perms.length} permission(s) removed`, severity: 'success' });
      if (tabValue === 0) fetchExternalSharing();
      else fetchFiles();
    } catch (error: any) {
      console.error('Error removing permissions:', error);
      setSnackbar({ open: true, message: error.response?.data?.error || 'Failed to remove some permissions', severity: 'error' });
    }
  };

  const togglePermissionSelected = (permissionId: string, isOwner: boolean) => {
    if (isOwner) return;
    setSelectedPermissionIds((prev) => {
      const next = new Set(prev);
      if (next.has(permissionId)) next.delete(permissionId);
      else next.add(permissionId);
      return next;
    });
  };

  const selectAllPermissions = (checked: boolean) => {
    if (!selectedFile) return;
    const nonOwner = (selectedFile.permissions ?? []).filter((p) => p.role !== 'owner').map((p) => p.id);
    setSelectedPermissionIds(checked ? new Set(nonOwner) : new Set());
  };

  const formatFileSize = (bytes?: string) => {
    if (!bytes) return '-';
    const size = parseInt(bytes);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleExportExternalSharing = async () => {
    try {
      const response = await apiClient.get('/drive/external-sharing/export', { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'text/csv' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `external-sharing-report-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      setSnackbar({ open: true, message: 'CSV downloading now.', severity: 'success' });
    } catch (error) {
      // In demo mode, export current external sharing data as CSV
      const reports = externalSharingData?.reports;
      if (isDemoMode() && Array.isArray(reports) && reports.length > 0) {
        const csvData = reports.map((report: any) => ({
          'File Name': report.file?.name ?? '',
          'File ID': report.file?.id ?? '',
          'File Path': report.file?.path || '/My Drive',
          'File Type': report.file?.mimeType ?? '',
          'Owner': report.file?.owners?.map((o: any) => o.emailAddress).join('; ') ?? '',
          'Created Date': report.file?.createdTime ? new Date(report.file.createdTime).toISOString() : '',
          'Modified Date': report.file?.modifiedTime ? new Date(report.file.modifiedTime).toISOString() : '',
          'Size (bytes)': report.file?.size ?? '',
          'External Domains': (report.externalDomains || []).join('; '),
          'External Emails': (report.externalEmails || []).join('; '),
          'Link': report.file?.webViewLink ?? '',
        }));
        const headers = Object.keys(csvData[0] || {});
        const csv = [
          headers.join(','),
          ...csvData.map((row: Record<string, string>) =>
            headers
              .map((h) => {
                const s = row[h] === null || row[h] === undefined ? '' : String(row[h]);
                return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
              })
              .join(',')
          ),
        ].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `external-sharing-report-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
        setSnackbar({ open: true, message: 'CSV downloading now.', severity: 'success' });
        return;
      }
      console.error('Error exporting external sharing report:', error);
      setSnackbar({ open: true, message: 'Export failed. Please try again.', severity: 'error' });
    }
  };

  const handleExportExternalSelectedCSV = async () => {
    if (selectedFiles.size === 0) return;
    const reports = externalSharingData?.reports ?? [];
    const selected = reports.filter((r: any) => r.file?.id && selectedFiles.has(r.file.id));
    if (selected.length === 0) return;
    const csvData = selected.map((report: any) => ({
      'File Name': report.file?.name ?? '',
      'File ID': report.file?.id ?? '',
      'File Path': report.file?.path || '/My Drive',
      'File Type': report.file?.mimeType ?? '',
      'Owner': report.file?.owners?.map((o: any) => o.emailAddress).join('; ') ?? '',
      'Created Date': report.file?.createdTime ? new Date(report.file.createdTime).toISOString() : '',
      'Modified Date': report.file?.modifiedTime ? new Date(report.file.modifiedTime).toISOString() : '',
      'Size (bytes)': report.file?.size ?? '',
      'External Domains': (report.externalDomains || []).join('; '),
      'External Emails': (report.externalEmails || []).join('; '),
      'Link': report.file?.webViewLink ?? '',
    }));
    const headers = Object.keys(csvData[0] || {});
    const csv = [
      headers.join(','),
      ...csvData.map((row: Record<string, string>) =>
        headers
          .map((h) => {
            const s = row[h] === null || row[h] === undefined ? '' : String(row[h]);
            return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(',')
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `external-sharing-selected-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
    setSnackbar({ open: true, message: 'Selected files exported.', severity: 'success' });
  };

  const handleExportSelectedCSV = async () => {
    if (selectedFiles.size === 0) return;
    const selected = files.filter((f) => selectedFiles.has(f.id));
    const workspaceDomain = '';
    const csvData = selected.map((file) => {
      const externalDomains: string[] = [];
      const externalEmails: string[] = [];
      for (const perm of file.permissions || []) {
        if (perm.type === 'domain' && perm.domain && perm.domain !== workspaceDomain) externalDomains.push(perm.domain);
        else if (perm.type === 'user' && perm.emailAddress) {
          const emailDomain = perm.emailAddress.split('@')[1];
          if (emailDomain !== workspaceDomain) {
            externalEmails.push(perm.emailAddress);
            if (!externalDomains.includes(emailDomain)) externalDomains.push(emailDomain);
          }
        }
      }
      return {
        'File Name': file.name,
        'File ID': file.id,
        'Owner': file.owners.map((o: any) => o.emailAddress).join('; '),
        'Created Date': file.createdTime || '',
        'Modified Date': file.modifiedTime || '',
        'Size (bytes)': file.size || '',
        'Shared': file.shared ? 'Yes' : 'No',
        'External Domains': externalDomains.join('; '),
        'External Emails': externalEmails.join('; '),
        'Link': file.webViewLink,
      };
    });
    const headers = Object.keys(csvData[0] || {});
    const csvRows = [
      headers.join(','),
      ...csvData.map((row) =>
        headers
          .map((h) => {
            const v = row[h as keyof typeof row];
            const s = v === null || v === undefined ? '' : String(v);
            return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(',')
      ),
    ].join('\n');
    const blob = new Blob([csvRows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `drive-files-selected-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
    setSnackbar({ open: true, message: 'Selected files exported.', severity: 'success' });
  };

  const handleExportAllDrive = async () => {
    try {
      const response = await apiClient.post('/drive/files/export/drive', { maxResults: 10000 });
      if (response.data?.webViewLink) window.open(response.data.webViewLink, '_blank');
      setSnackbar({ open: true, message: 'Saved to Google Drive.', severity: 'success' });
    } catch (err: any) {
      console.error(err);
      setSnackbar({ open: true, message: err?.response?.data?.error || 'Drive export failed.', severity: 'error' });
    }
  };

  const handleExportSelectedDrive = async () => {
    if (selectedFiles.size === 0) return;
    try {
      const response = await apiClient.post('/drive/files/export/selected/drive', { fileIds: Array.from(selectedFiles) });
      if (response.data?.webViewLink) window.open(response.data.webViewLink, '_blank');
      setSnackbar({ open: true, message: 'Selection saved to Google Drive.', severity: 'success' });
    } catch (err: any) {
      console.error(err);
      setSnackbar({ open: true, message: err?.response?.data?.error || 'Drive export failed.', severity: 'error' });
    }
  };

  const handleExportExternalSharingDrive = async () => {
    try {
      const response = await apiClient.post('/drive/external-sharing/export/drive');
      if (response.data?.webViewLink) window.open(response.data.webViewLink, '_blank');
      setSnackbar({ open: true, message: 'Report saved to Google Drive.', severity: 'success' });
    } catch (err: any) {
      console.error(err);
      setSnackbar({ open: true, message: err?.response?.data?.error || 'Drive export failed.', severity: 'error' });
    }
  };

  exportCSVRef.current = handleExportCSV;
  exportSelectedCSVRef.current = handleExportSelectedCSV;
  exportExternalSharingRef.current = handleExportExternalSharing;
  exportExternalSelectedCSVRef.current = handleExportExternalSelectedCSV;

  const formatFilterDateRange = (from: string, to: string): string => {
    if (!from && !to) return 'Any';
    if (from && to && from === to) return from;
    if (from && to) return `${from} – ${to}`;
    if (from) return `From ${from}`;
    return `To ${to}`;
  };

  const activeFilterLabels = useMemo(() => {
    const labels: { key: string; label: string }[] = [];
    if (filters.owner) labels.push({ key: 'owner', label: `Owner: ${filters.owner}` });
    if (filters.mimeType) {
      const mimeLabel = DRIVE_MIME_OPTIONS.find((o) => o.value === filters.mimeType)?.label || filters.mimeType;
      labels.push({ key: 'mimeType', label: `Type: ${mimeLabel}` });
    }
    if (filters.pathContains) labels.push({ key: 'pathContains', label: `Path: ${filters.pathContains}` });
    if (filters.minSize) labels.push({ key: 'minSize', label: `Min size: ${filters.minSize}` });
    if (filters.maxSize) labels.push({ key: 'maxSize', label: `Max size: ${filters.maxSize}` });
    if (filters.createdFrom || filters.createdTo) labels.push({ key: 'createdFrom', label: `Created: ${formatFilterDateRange(filters.createdFrom, filters.createdTo)}` });
    if (filters.modifiedFrom || filters.modifiedTo) labels.push({ key: 'modifiedFrom', label: `Modified: ${formatFilterDateRange(filters.modifiedFrom, filters.modifiedTo)}` });
    if (filters.shared) labels.push({ key: 'shared', label: filters.shared === 'true' ? 'Shared' : 'Not Shared' });
    if (filters.externallyShared) labels.push({ key: 'externallyShared', label: filters.externallyShared === 'true' ? 'Externally Shared' : 'Not Ext. Shared' });
    if (filters.domain) labels.push({ key: 'domain', label: `Domain: ${filters.domain}` });
    return labels;
  }, [filters]);

  const allFilePerms = selectedFile?.permissions ?? [];
  const fpMaxPage = Math.max(0, Math.ceil(allFilePerms.length / filePermissionsRowsPerPage) - 1);
  const fpPageSafe = Math.min(filePermissionsPage, fpMaxPage);
  const pagedFilePermissions = useMemo(() => {
    const start = fpPageSafe * filePermissionsRowsPerPage;
    return allFilePerms.slice(start, start + filePermissionsRowsPerPage);
  }, [selectedFile?.id, selectedFile?.permissions, fpPageSafe, filePermissionsRowsPerPage]);

  return (
    <Box sx={{ width: '100%', overflowY: 'auto', overflowX: 'hidden', fontFamily: T.font, minHeight: '100vh' }}>
      {/* PAGE HEADER */}
      <Box sx={{ mb: 3, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, alignItems: { md: 'center' }, justifyContent: 'space-between' }}>
        <Typography sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.02em', color: (th) => pick(th, T.text, '#fafafa') }}>
          Drive
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <SegmentedControl value={tabValue} options={['External Shares', 'All Files']} onChange={(v) => { setTabValue(v); setSelectedFiles(new Set()); setPage(0); }} />
        </Box>
      </Box>

      {/* Toolbar: search + filters + export */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          inputRef={searchInputRef}
          size="small"
          placeholder={tabValue === 0 ? "Search external shares\u2026" : "Search files\u2026"}
          value={tabValue === 0 ? externalSearchTerm : filters.nameContains}
          onChange={(e) => tabValue === 0 ? setExternalSearchTerm(e.target.value) : handleFilterChange('nameContains', e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Box component="span" sx={{ display: 'flex', color: (t: any) => textTertiary(t) }}>
                  <Search size={18} strokeWidth={1.75} />
                </Box>
              </InputAdornment>
            ),
            ...((tabValue === 0 ? externalSearchTerm : filters.nameContains) ? { endAdornment: (
              <InputAdornment position="end">
                <Box component="span" onClick={() => tabValue === 0 ? setExternalSearchTerm('') : handleFilterChange('nameContains', '')} sx={{ display: 'flex', cursor: 'pointer', color: (t: any) => textTertiary(t) }}>
                  <X size={16} strokeWidth={2} />
                </Box>
              </InputAdornment>
            ) } : {}),
          }}
          sx={(theme: any) => ({
            flex: '1 1 240px',
            maxWidth: 360,
            '& .MuiOutlinedInput-root': {
              fontFamily: T.font,
              fontSize: '0.8125rem',
              borderRadius: T.radius,
              bgcolor: pick(theme, T.surface, '#27272a'),
              '& fieldset': { borderColor: pick(theme, T.border, '#3f3f46') },
              '&:hover fieldset': { borderColor: pick(theme, T.textTertiary, '#52525b') },
            },
          })}
        />

        {tabValue === 1 && (
          <Tooltip title="Filters">
            <IconButton
              size="small"
              onClick={() => setFiltersVisible((v) => !v)}
              sx={(theme: any) => ({
                color: filtersVisible || hasActiveFilters() ? T.accent : textSecondary(theme),
                bgcolor: filtersVisible ? pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.2)') : 'transparent',
                borderRadius: T.radiusSm,
                '&:hover': { bgcolor: pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.2)') },
              })}
            >
              <ListFilter size={18} strokeWidth={1.75} />
            </IconButton>
          </Tooltip>
        )}

        <Tooltip title="Refresh data">
          <IconButton
            size="small"
            onClick={() => {
              if (tabValue === 0) fetchExternalSharing();
              else fetchFiles();
            }}
            aria-label="Refresh data"
            sx={{ color: (t: any) => textSecondary(t) }}
          >
            <RefreshCw size={18} strokeWidth={1.75} />
          </IconButton>
        </Tooltip>

        <Box sx={{ flex: 1 }} />

        {selectedFiles.size > 0 && tabValue === 0 && (
          <Button
            size="small"
            variant="contained"
            color="error"
            onClick={handleBulkRemoveExternalShares}
            disabled={bulkActionLoading}
            startIcon={bulkActionLoading ? <CircularProgress size={14} color="inherit" /> : <Ban size={15} strokeWidth={1.75} />}
            sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, height: 30, px: 1.5 }}
          >
            Remove {selectedFiles.size} selected
          </Button>
        )}

        {tabValue === 0 && (
          <ExportButton
            iconOnly={!isMdUp}
            tooltipTitle="Export external sharing report"
            totalItems={filteredExternalReports.length}
            selectedCount={selectedFiles.size}
            hasFilters={false}
            onExportSelectedCSV={handleExportExternalSelectedCSV}
            onExportAllCSV={handleExportExternalSharing}
            onExportAllDrive={handleExportExternalSharingDrive}
            onExportSelectedDrive={handleExportExternalSharingDrive}
            onExportFilteredCSV={handleExportExternalSharing}
            onExportFilteredDrive={handleExportExternalSharingDrive}
            disabled={externalSharingLoading}
            triggerSx={exportToolbarButtonSx()}
          />
        )}
        {tabValue === 1 && (
          <ExportButton
            iconOnly={!isMdUp}
            tooltipTitle="Export"
            totalItems={files.length}
            selectedCount={selectedFiles.size}
            hasFilters={hasActiveFilters()}
            onExportSelectedCSV={handleExportSelectedCSV}
            onExportAllCSV={handleExportCSV}
            onExportAllDrive={handleExportAllDrive}
            onExportSelectedDrive={handleExportSelectedDrive}
            onExportFilteredCSV={handleExportCSV}
            onExportFilteredDrive={handleExportAllDrive}
            disabled={files.length === 0}
            triggerSx={exportToolbarButtonSx()}
          />
        )}
      </Box>

      {/* Filter panel (collapsible, All Files tab only) */}
      {tabValue === 1 && (
        <>
          <Box sx={{ overflow: 'hidden', maxHeight: filtersVisible ? 320 : 0, transition: 'max-height 0.25s ease, opacity 0.2s ease', opacity: filtersVisible ? 1 : 0, mb: filtersVisible ? 2 : 0 }}>
            <Box sx={(theme: any) => ({
              display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center',
              p: 1.5, borderRadius: T.radius, border: `1px solid ${pick(theme, T.border, '#3f3f46')}`, bgcolor: pick(theme, T.surface, '#27272a'),
            })}>
              <TextField size="small" placeholder="Owner" value={filters.owner} onChange={(e) => handleFilterChange('owner', e.target.value)}
                sx={{ fontFamily: T.font, '& .MuiOutlinedInput-root': { fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm }, maxWidth: 160 }} />
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <Select
                  value={filters.mimeType} displayEmpty
                  renderValue={(v) => DRIVE_MIME_OPTIONS.find((o) => o.value === v)?.label || 'Type'}
                  onChange={(e) => handleFilterChange('mimeType', e.target.value)}
                  MenuProps={selectMenuProps}
                  sx={{ fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm }}
                >
                  <MenuItem value="">Any</MenuItem>
                  {DRIVE_MIME_OPTIONS.filter((o) => o.value).map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField size="small" placeholder="Path" value={filters.pathContains} onChange={(e) => handleFilterChange('pathContains', e.target.value)}
                sx={{ fontFamily: T.font, '& .MuiOutlinedInput-root': { fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm }, maxWidth: 140 }} />
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <Select
                  value={filters.shared} displayEmpty
                  renderValue={(v) => (v === 'true' ? 'Shared' : v === 'false' ? 'Not Shared' : 'Shared?')}
                  onChange={(e) => handleFilterChange('shared', e.target.value)}
                  MenuProps={selectMenuProps}
                  sx={{ fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm }}
                >
                  <MenuItem value="">Any</MenuItem>
                  <MenuItem value="true">Shared</MenuItem>
                  <MenuItem value="false">Not Shared</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <Select
                  value={filters.externallyShared} displayEmpty
                  renderValue={(v) => (v === 'true' ? 'External' : v === 'false' ? 'Not External' : 'External?')}
                  onChange={(e) => handleFilterChange('externallyShared', e.target.value)}
                  MenuProps={selectMenuProps}
                  sx={{ fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm }}
                >
                  <MenuItem value="">Any</MenuItem>
                  <MenuItem value="true">Externally Shared</MenuItem>
                  <MenuItem value="false">Not Externally Shared</MenuItem>
                </Select>
              </FormControl>
              <TextField size="small" placeholder="Domain" value={filters.domain} onChange={(e) => handleFilterChange('domain', e.target.value)}
                sx={{ fontFamily: T.font, '& .MuiOutlinedInput-root': { fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm }, maxWidth: 130 }} />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography component="span" sx={{ fontFamily: T.font, fontSize: '0.75rem', fontWeight: 500, color: (t: any) => textTertiary(t), whiteSpace: 'nowrap' }}>Created</Typography>
                <Button size="small" variant="outlined" startIcon={<Calendar size={18} strokeWidth={1.75} />}
                  onClick={(e) => setCreatedDateAnchor(e.currentTarget)}
                  sx={(theme: any) => ({ fontFamily: T.font, fontSize: '0.75rem', textTransform: 'none', borderRadius: T.radiusSm, borderColor: pick(theme, T.border, '#5f6368'), color: textSecondary(theme), py: 0.5, '&:hover': { borderColor: pick(theme, T.accent, '#8ab4f8'), bgcolor: pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.08)') } })}>
                  {formatFilterDateRange(filters.createdFrom, filters.createdTo)}
                </Button>
              </Box>
              <Popover open={!!createdDateAnchor} anchorEl={createdDateAnchor} onClose={() => setCreatedDateAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
                <Box sx={{ p: 2 }}>
                  <DateRangeCalendar mode="single-or-range" value={{ from: filters.createdFrom, to: filters.createdTo }} onChange={(v) => { const r = typeof v === 'string' ? { from: v, to: v } : v; handleFilterChange('createdFrom', r.from); handleFilterChange('createdTo', r.to); }} onClose={() => setCreatedDateAnchor(null)} />
                </Box>
              </Popover>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography component="span" sx={{ fontFamily: T.font, fontSize: '0.75rem', fontWeight: 500, color: (t: any) => textTertiary(t), whiteSpace: 'nowrap' }}>Modified</Typography>
                <Button size="small" variant="outlined" startIcon={<Calendar size={18} strokeWidth={1.75} />}
                  onClick={(e) => setModifiedDateAnchor(e.currentTarget)}
                  sx={(theme: any) => ({ fontFamily: T.font, fontSize: '0.75rem', textTransform: 'none', borderRadius: T.radiusSm, borderColor: pick(theme, T.border, '#5f6368'), color: textSecondary(theme), py: 0.5, '&:hover': { borderColor: pick(theme, T.accent, '#8ab4f8'), bgcolor: pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.08)') } })}>
                  {formatFilterDateRange(filters.modifiedFrom, filters.modifiedTo)}
                </Button>
              </Box>
              <Popover open={!!modifiedDateAnchor} anchorEl={modifiedDateAnchor} onClose={() => setModifiedDateAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
                <Box sx={{ p: 2 }}>
                  <DateRangeCalendar mode="single-or-range" value={{ from: filters.modifiedFrom, to: filters.modifiedTo }} onChange={(v) => { const r = typeof v === 'string' ? { from: v, to: v } : v; handleFilterChange('modifiedFrom', r.from); handleFilterChange('modifiedTo', r.to); }} onClose={() => setModifiedDateAnchor(null)} />
                </Box>
              </Popover>
              <TextField size="small" placeholder="Min size" type="number" value={filters.minSize} onChange={(e) => handleFilterChange('minSize', e.target.value)}
                sx={{ fontFamily: T.font, '& .MuiOutlinedInput-root': { fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm }, maxWidth: 100 }} />
              <TextField size="small" placeholder="Max size" type="number" value={filters.maxSize} onChange={(e) => handleFilterChange('maxSize', e.target.value)}
                sx={{ fontFamily: T.font, '& .MuiOutlinedInput-root': { fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm }, maxWidth: 100 }} />
              {hasActiveFilters() && (
                <Button size="small" onClick={clearFilters} sx={{ fontFamily: T.font, fontSize: '0.75rem', textTransform: 'none', color: (t: any) => textSecondary(t) }}>
                  Clear all
                </Button>
              )}
            </Box>
          </Box>

          {activeFilterLabels.length > 0 && !filtersVisible && (
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.5 }}>
              {activeFilterLabels.map((t) => (
                <FilterToken key={t.key} label={t.label} onRemove={() => {
                  if (t.key === 'createdFrom') { handleFilterChange('createdFrom', ''); handleFilterChange('createdTo', ''); }
                  else if (t.key === 'modifiedFrom') { handleFilterChange('modifiedFrom', ''); handleFilterChange('modifiedTo', ''); }
                  else handleFilterChange(t.key as keyof DriveFilters, '');
                }} />
              ))}
            </Box>
          )}
        </>
      )}

      {tabValue === 1 && (
        <Box>
            {loading && (
              <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography sx={{ fontFamily: T.font, fontSize: '0.875rem', color: (t) => textSecondary(t) }}>
                  Loading files...
                </Typography>
                <Box sx={{ flex: 1, maxWidth: 300 }}>
                  <LinearProgress variant="indeterminate" />
                </Box>
              </Box>
            )}
            {selectedFiles.size > 0 && (
              <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'center' }}>
                <Button
                  size="small"
                  variant="contained"
                  color="error"
                  onClick={handleBulkRemoveExternalShares}
                  disabled={bulkActionLoading}
                  startIcon={bulkActionLoading ? <CircularProgress size={14} color="inherit" /> : <Ban size={15} strokeWidth={1.75} />}
                  sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, height: 30, px: 1.5 }}
                >
                  Remove {selectedFiles.size} selected
                </Button>
                <Tooltip title="Clear selection">
                  <IconButton size="small" onClick={() => setSelectedFiles(new Set())} aria-label="Clear selection" sx={{ color: (t: any) => textSecondary(t) }}>
                    <X size={18} strokeWidth={1.75} />
                  </IconButton>
                </Tooltip>
              </Box>
            )}

            <Box sx={{ overflowX: { xs: 'auto', md: 'visible' }, position: 'relative' }}>
              {/* Mobile scroll indicator */}
              <Box
                sx={{
                  display: { xs: 'block', md: 'none' },
                  position: 'absolute',
                  top: -24,
                  right: 0,
                  fontSize: '0.75rem',
                  color: (t) => textSecondary(t),
                  fontFamily: T.font,
                  pointerEvents: 'none',
                  zIndex: 1
                }}
              >
                ← Swipe to scroll →
              </Box>
              <ListShell>
                <ListHeaderRow>
                  <Box sx={{ p: 0.25, mr: 0.5, flexShrink: 0 }}>
                    <Checkbox
                      size="small"
                      indeterminate={selectedFiles.size > 0 && selectedFiles.size < files.length}
                      checked={files.length > 0 && selectedFiles.size === files.length}
                      onChange={handleSelectAll}
                    />
                  </Box>
                  <Box sx={{ width: { xs: 200, sm: 180, md: '18%' }, minWidth: { xs: 200, sm: 180 } }}>
                    <ColumnHeader label="File Name" columnId="fn" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} />
                  </Box>
                  <Box sx={{ flex: 1, display: { xs: 'none', sm: 'block' } }}>
                    <ColumnHeader label="Owner" columnId="ow" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} />
                  </Box>
                  <Box sx={{ width: { xs: 100, sm: 104 }, display: { xs: 'none', md: 'block' } }}>
                    <ColumnHeader label="Created" columnId="cr" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} />
                  </Box>
                  <Box sx={{ width: { xs: 100, sm: 104 }, display: { xs: 'none', lg: 'block' } }}>
                    <ColumnHeader label="Modified" columnId="mo" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} />
                  </Box>
                  <Box sx={{ width: { xs: 80, sm: 80 }, display: { xs: 'none', sm: 'block' } }}>
                    <ColumnHeader label="Size" columnId="sz" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} />
                  </Box>
                  <Box sx={{ width: { xs: 120, sm: 140, md: '14%' }, display: { xs: 'none', sm: 'block' } }}>
                    <ColumnHeader label="Location" columnId="loc" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} />
                  </Box>
                  <Box sx={{ width: 48, flexShrink: 0 }}>
                    <ColumnHeader label="Open" columnId="op" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} align="center" />
                  </Box>
                  <Box sx={{ width: 52, flexShrink: 0 }}>
                    <ColumnHeader label="Perm" columnId="pm" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} align="center" />
                  </Box>
                </ListHeaderRow>
              {files.length === 0 ? (
                <Box sx={{ py: 6, textAlign: 'center' }}>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>
                    {loading ? 'Loading files...' : 'No files found'}
                  </Typography>
                </Box>
              ) : (
                files.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map((file, fIdx, arr) => {
                  const isSelected = selectedFiles.has(file.id);
                  return (
                    <ListDataRow key={file.id} last={fIdx === arr.length - 1} selected={isSelected}>
                      <Checkbox size="small" checked={isSelected} onChange={() => handleSelectFile(file.id)} sx={{ p: 0.25, mr: 0.5, flexShrink: 0 }} />
                      <Box sx={{ width: { xs: 200, sm: 180, md: '18%' }, minWidth: { xs: 200, sm: 180 }, overflow: 'hidden' }}>
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, color: (th) => pick(th, T.text, '#fafafa'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</Typography>
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0, display: { xs: 'none', sm: 'block' } }}>
                        {file.owners.map((owner) => (
                          <Typography key={owner.emailAddress} sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), display: 'block' }}>
                            {owner.displayName || owner.emailAddress}
                          </Typography>
                        ))}
                      </Box>
                      <Box sx={{ width: { xs: 100, sm: 104 }, flexShrink: 0, display: { xs: 'none', md: 'block' } }}>
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{file.createdTime ? new Date(file.createdTime).toLocaleDateString() : '—'}</Typography>
                      </Box>
                      <Box sx={{ width: { xs: 100, sm: 104 }, flexShrink: 0, display: { xs: 'none', lg: 'block' } }}>
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{new Date(file.modifiedTime).toLocaleDateString()}</Typography>
                      </Box>
                      <Box sx={{ width: { xs: 80, sm: 80 }, flexShrink: 0, display: { xs: 'none', sm: 'block' } }}>
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{formatFileSize(file.size)}</Typography>
                      </Box>
                      <Box sx={{ width: { xs: 120, sm: 140, md: '14%' }, minWidth: { xs: 120, sm: 140 }, display: { xs: 'none', sm: 'block' } }}>
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{getFileLocationLabel(file)}</Typography>
                      </Box>
                      <Box sx={{ width: 48, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                        <Tooltip title="Open in Google Drive">
                          <Link href={file.webViewLink} target="_blank" rel="noopener noreferrer" sx={{ display: 'inline-flex', alignItems: 'center', color: T.accent }}>
                            <ExternalLink size={16} strokeWidth={1.75} />
                          </Link>
                        </Tooltip>
                      </Box>
                      <Box sx={{ width: 52, flexShrink: 0, display: 'flex', justifyContent: 'center', '& .MuiIconButton-root': { color: T.accent } }}>
                        <Tooltip title="Manage Permissions">
                          <IconButton size="small" color="primary" onClick={(e) => { e.stopPropagation(); handleOpenPermissionDialog(file); }} aria-label="Manage Permissions" sx={{ p: 0.5 }}>
                            <Pencil size={16} strokeWidth={1.75} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </ListDataRow>
                  );
                })
              )}
            </ListShell>
          </Box>

      {files.length > 0 && (
        <TablePagination
          component="div"
          count={files.length}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[25, 50, 100]}
          {...tablePaginationProps(muiTheme)}
        />
      )}
        </Box>
      )}

      {tabValue === 0 && (
        <Box>
          {externalSharingLoading && (
            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography sx={{ fontFamily: T.font, fontSize: '0.875rem', color: (t) => textSecondary(t) }}>
                Scanning files for external shares...
              </Typography>
              <Box sx={{ flex: 1, maxWidth: 300 }}>
                <LinearProgress variant="indeterminate" />
              </Box>
            </Box>
          )}
          {!externalSharingLoading && (
            <>
                <Box sx={{ overflowX: { xs: 'auto', md: 'visible' }, position: 'relative' }}>
                  {/* Mobile scroll indicator */}
                  <Box
                    sx={{
                      display: { xs: 'block', md: 'none' },
                      position: 'absolute',
                      top: -24,
                      right: 0,
                      fontSize: '0.75rem',
                      color: (t) => textSecondary(t),
                      fontFamily: T.font,
                      pointerEvents: 'none',
                      zIndex: 1
                    }}
                  >
                    ← Swipe to scroll →
                  </Box>
                  <ListShell>
                    <ListHeaderRow>
                      <Box sx={{ p: 0.25, mr: 0.5, flexShrink: 0 }}>
                        <Checkbox
                          size="small"
                          indeterminate={(() => {
                            const selectedOnPage = paginatedExternalReports.filter((r: any) => r.file?.id && selectedFiles.has(r.file.id)).length;
                            return selectedOnPage > 0 && selectedOnPage < paginatedExternalReports.length;
                          })()}
                          checked={
                            paginatedExternalReports.length > 0 &&
                            paginatedExternalReports.every((r: any) => r.file?.id && selectedFiles.has(r.file.id))
                          }
                          onChange={handleSelectAllExternal}
                        />
                      </Box>
                      <Box sx={{ width: { xs: 200, sm: 180, md: '18%' }, minWidth: { xs: 200, sm: 180 } }}>
                        <ColumnHeader label="File Name" columnId="efn" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} />
                      </Box>
                      <Box sx={{ flex: 1, display: { xs: 'none', sm: 'block' } }}>
                        <ColumnHeader label="Owner" columnId="eow" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} />
                      </Box>
                      <Box sx={{ width: { xs: 100, sm: 104 }, display: { xs: 'none', md: 'block' } }}>
                        <ColumnHeader label="Created" columnId="ecr" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} />
                      </Box>
                      <Box sx={{ width: { xs: 100, sm: 104 }, display: { xs: 'none', lg: 'block' } }}>
                        <ColumnHeader label="Modified" columnId="emo" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} />
                      </Box>
                      <Box sx={{ width: { xs: 80, sm: 80 }, display: { xs: 'none', sm: 'block' } }}>
                        <ColumnHeader label="Size" columnId="esz" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} />
                      </Box>
                      <Box sx={{ width: { xs: 120, sm: 140, md: '14%' }, display: { xs: 'none', sm: 'block' } }}>
                        <ColumnHeader label="Location" columnId="eloc" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} />
                      </Box>
                      <Box sx={{ width: 48, flexShrink: 0 }}>
                        <ColumnHeader label="Open" columnId="eop" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} align="center" />
                      </Box>
                      <Box sx={{ width: 52, flexShrink: 0 }}>
                        <ColumnHeader label="Perm" columnId="epm" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} align="center" />
                      </Box>
                    </ListHeaderRow>
                {filteredExternalReports.length === 0 ? (
                  <Box sx={{ py: 6, textAlign: 'center' }}>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>{externalSharingLoading ? 'Loading…' : 'No external sharing data'}</Typography>
                  </Box>
                ) : (
                  paginatedExternalReports.map((report: any, idx: number) => {
                    const f = report.file ?? {};
                    const id = f.id ?? '';
                    const isSelected = Boolean(id && selectedFiles.has(id));
                    return (
                      <ListDataRow key={id || report.file?.name} last={idx === paginatedExternalReports.length - 1} selected={isSelected}>
                        {id ? (
                          <Checkbox size="small" checked={isSelected} onChange={() => handleSelectFile(id)} sx={{ p: 0.25, mr: 0.5, flexShrink: 0 }} />
                        ) : (
                          <Box sx={{ width: 34, flexShrink: 0, mr: 0.5 }} />
                        )}
                        <Box sx={{ width: { xs: 200, sm: 180, md: '18%' }, minWidth: { xs: 200, sm: 180 }, overflow: 'hidden' }}>
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, color: (th) => pick(th, T.text, '#fafafa'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name ?? '—'}</Typography>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0, display: { xs: 'none', sm: 'block' } }}>
                          {f.owners?.length ? (
                            f.owners.map((o: any) => (
                              <Typography key={o.emailAddress} sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), display: 'block' }}>
                                {o.displayName || o.emailAddress}
                              </Typography>
                            ))
                          ) : (
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>—</Typography>
                          )}
                        </Box>
                        <Box sx={{ width: { xs: 100, sm: 104 }, flexShrink: 0, display: { xs: 'none', md: 'block' } }}>
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{f.createdTime ? new Date(f.createdTime).toLocaleDateString() : '—'}</Typography>
                        </Box>
                        <Box sx={{ width: { xs: 100, sm: 104 }, flexShrink: 0, display: { xs: 'none', lg: 'block' } }}>
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '—'}</Typography>
                        </Box>
                        <Box sx={{ width: { xs: 80, sm: 80 }, flexShrink: 0, display: { xs: 'none', sm: 'block' } }}>
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{f.size != null ? formatFileSize(f.size) : '—'}</Typography>
                        </Box>
                        <Box sx={{ width: { xs: 120, sm: 140, md: '14%' }, minWidth: { xs: 120, sm: 140 }, display: { xs: 'none', sm: 'block' } }}>
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {getFileLocationLabel({ ...f, path: f.path ?? '' } as DriveFile)}
                          </Typography>
                        </Box>
                        <Box sx={{ width: 48, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                          {f.webViewLink ? (
                            <Tooltip title="Open in Google Drive">
                              <Link href={f.webViewLink} target="_blank" rel="noopener noreferrer" sx={{ display: 'inline-flex', alignItems: 'center', color: T.accent }}>
                                <ExternalLink size={16} strokeWidth={1.75} />
                              </Link>
                            </Tooltip>
                          ) : (
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textTertiary(t) }}>—</Typography>
                          )}
                        </Box>
                        <Box sx={{ width: 52, flexShrink: 0, display: 'flex', justifyContent: 'center', '& .MuiIconButton-root': { color: T.accent } }}>
                          <Tooltip title="Manage Permissions">
                            <IconButton size="small" color="primary" onClick={(e) => { e.stopPropagation(); handleOpenPermissionDialogForReport(report); }} aria-label="Manage Permissions" sx={{ p: 0.5 }}>
                              <Pencil size={16} strokeWidth={1.75} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </ListDataRow>
                    );
                  })
                )}
                </ListShell>
              </Box>
              {filteredExternalReports.length > 0 && (
                <TablePagination
                  component="div"
                  count={filteredExternalReports.length}
                  page={page}
                  onPageChange={(_, newPage) => setPage(newPage)}
                  rowsPerPage={rowsPerPage}
                  onRowsPerPageChange={(e) => {
                    setRowsPerPage(parseInt(e.target.value, 10));
                    setPage(0);
                  }}
                  rowsPerPageOptions={[25, 50, 100]}
                  {...tablePaginationProps(muiTheme)}
                />
              )}
            </>
          )}
        </Box>
      )}

      {/* Permission Management Dialog */}
      <Dialog
        open={permissionDialogOpen}
        onClose={() => {
          setPermissionDialogOpen(false);
          setSelectedPermissionIds(new Set());
        }}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: dialogPaperSx }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5, borderBottom: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}` }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.02em', color: (t) => pick(t, T.text, '#fafafa'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedFile?.name}</Typography>
            <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textSecondary(t), mt: 0.25 }}>Manage Permissions</Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: '20px !important' }}>
          {selectedFile && (
            <Box>
              <Typography sx={{ fontFamily: T.font, fontWeight: 600, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: (t) => textTertiary(t), mb: 1 }}>File details</Typography>
              <Grid container spacing={1.5} sx={{ mb: 2 }}>
                <Grid item xs={12}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" display="block">File ID</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8125rem', wordBreak: 'break-all' }}>
                    {selectedFile.id}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" display="block">Type</Typography>
                  <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>{selectedFile.mimeType}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" display="block">Path</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8125rem', wordBreak: 'break-all' }}>
                    {selectedFile.path || '/My Drive'}
                  </Typography>
                </Grid>
              </Grid>
              <Divider sx={{ my: 2 }} />
              <Typography sx={{ fontFamily: T.font, fontWeight: 600, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: (t) => textTertiary(t), mb: 1 }}>Permissions</Typography>
              {selectedPermissionIds.size > 0 && (
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mb: 1.5 }}>
                  <Tooltip title={`Remove selected (${selectedPermissionIds.size})`}>
                    <IconButton size="small" color="error" onClick={handleBulkRemovePermissions} aria-label="Remove selected">
                      <Trash2 size={16} strokeWidth={1.75} />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
              <ListShell>
                <ListHeaderRow>
                  {(selectedFile.permissions ?? []).filter((p) => p.role !== 'owner').length > 0 ? (
                    <Box sx={{ width: 42, flexShrink: 0, display: 'flex', alignItems: 'center', mr: 0.5 }}>
                      <Checkbox
                        size="small"
                        indeterminate={
                          selectedPermissionIds.size > 0 &&
                          selectedPermissionIds.size < (selectedFile.permissions ?? []).filter((p) => p.role !== 'owner').length
                        }
                        checked={
                          (selectedFile.permissions ?? []).filter((p) => p.role !== 'owner').length > 0 &&
                          (selectedFile.permissions ?? []).filter((p) => p.role !== 'owner').every((p) => selectedPermissionIds.has(p.id))
                        }
                        onChange={(_, checked) => selectAllPermissions(checked)}
                        sx={{ p: 0.25 }}
                      />
                    </Box>
                  ) : (
                    <Box sx={{ width: 42, mr: 0.5, flexShrink: 0 }} />
                  )}
                  <ColumnHeader label="Type" columnId="dt" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} width={72} />
                  <ColumnHeader label="Email/Domain" columnId="de" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} />
                  <ColumnHeader label="Role" columnId="dr" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} width="28%" />
                  <ColumnHeader label="External" columnId="dx" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} width={88} align="center" />
                  <ColumnHeader label="Remove" columnId="drm" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} width={72} align="center" />
                </ListHeaderRow>
                {(selectedFile.permissions ?? []).filter((p) => p.role !== 'owner').length === 0 && !addPermissionDialogOpen && (
                  <Box sx={{ py: 4, textAlign: 'center' }}>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>No permissions found</Typography>
                  </Box>
                )}
                {pagedFilePermissions.map((permission, idx) => {
                  const isEditing = selectedPermission?.id === permission.id;
                  const isOwner = permission.role === 'owner';
                  const canSelect = !isOwner;
                  const isSelected = selectedPermissionIds.has(permission.id);
                  const allPerms = selectedFile.permissions ?? [];
                  const globalIdx = fpPageSafe * filePermissionsRowsPerPage + idx;
                  const isLastDataRow = globalIdx === allPerms.length - 1;
                  return (
                    <ListDataRow key={permission.id} last={isLastDataRow && addPermissionDialogOpen} selected={canSelect && isSelected}>
                      <Box sx={{ width: 42, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', mr: 0.5 }}>
                        {canSelect ? (
                          <Checkbox size="small" checked={isSelected} onChange={() => togglePermissionSelected(permission.id, isOwner)} sx={{ p: 0.25 }} />
                        ) : null}
                      </Box>
                      <Box sx={{ width: 72, flexShrink: 0 }}>
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{permission.type}</Typography>
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), wordBreak: 'break-word' }}>
                          {permission.type === 'anyone'
                            ? 'Anyone'
                            : permission.type === 'domain' && permission.domain?.toLowerCase() === WORKSPACE_DOMAIN.toLowerCase()
                              ? `${permission.domain} (entire org)`
                              : permission.emailAddress || permission.domain || permission.displayName || '—'}
                        </Typography>
                      </Box>
                      <Box sx={{ width: '28%', minWidth: 120 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 32 }}>
                          {isEditing ? (
                            <Select
                              size="small"
                              value={newRole}
                              onChange={(e) => setNewRole(e.target.value)}
                              sx={{
                                minWidth: 120,
                                height: 32,
                                fontSize: '0.875rem',
                                fontFamily: T.font,
                                '& .MuiSelect-select': { py: 0.5, minHeight: 'auto' },
                              }}
                            >
                              {FILE_PERMISSION_ROLES.map((r) => (
                                <MenuItem key={r.value} value={r.value}>
                                  {r.label}
                                </MenuItem>
                              ))}
                            </Select>
                          ) : (
                            <>
                              <Box sx={{ width: 34, height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {!isOwner ? (
                                  <Tooltip title="Change role">
                                    <IconButton size="small" onClick={() => handleOpenPermissionDialog(selectedFile, permission)} sx={{ p: 0.25, color: T.accent }}>
                                      <Pencil size={16} strokeWidth={1.75} />
                                    </IconButton>
                                  </Tooltip>
                                ) : null}
                              </Box>
                              <Typography sx={{ fontFamily: T.font, fontSize: '0.875rem', color: (t) => textSecondary(t) }}>{getFileRoleLabel(permission.role)}</Typography>
                            </>
                          )}
                        </Box>
                      </Box>
                      <Box sx={{ width: 88, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                        {isPermissionExternal(permission) ? (
                          <DotLabel dotColor={T.warning}>External</DotLabel>
                        ) : (
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textTertiary(t) }}>—</Typography>
                        )}
                      </Box>
                      <Box sx={{ width: 72, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                        {!isOwner && (
                          <Tooltip title="Remove permission">
                            <IconButton size="small" color="error" onClick={() => handleDeletePermission(selectedFile.id, permission.id)} sx={{ p: 0.5 }}>
                              <Trash2 size={16} strokeWidth={1.75} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    </ListDataRow>
                  );
                })}
                <DialogListPagination
                  page={fpPageSafe}
                  rowsPerPage={filePermissionsRowsPerPage}
                  total={allFilePerms.length}
                  onPageChange={setFilePermissionsPage}
                  onRowsPerPageChange={(n) => {
                    setFilePermissionsRowsPerPage(n);
                    setFilePermissionsPage(0);
                  }}
                />
                {addPermissionDialogOpen ? (
                  <Box
                    sx={(t) => ({
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      px: 2,
                      py: 1.25,
                      borderTop: `1px solid ${pick(t, T.borderSubtle, '#27272a')}`,
                      bgcolor: pick(t, T.surfaceHover, '#27272a'),
                    })}
                  >
                    <Box sx={{ width: 42, flexShrink: 0 }} />
                    <Box sx={{ width: 72, flexShrink: 0 }}>
                      <FormControl size="small" fullWidth sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.8125rem', '& .MuiSelect-select': { py: 0.5 } } }}>
                        <Select value={newPermissionType} onChange={(e) => setNewPermissionType(e.target.value as 'user' | 'domain' | 'anyone')} displayEmpty>
                          <MenuItem value="user">User</MenuItem>
                          <MenuItem value="domain">Domain</MenuItem>
                          <MenuItem value="anyone">Anyone with link</MenuItem>
                        </Select>
                      </FormControl>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      {newPermissionType === 'anyone' ? (
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>Anyone</Typography>
                      ) : newPermissionType === 'domain' ? (
                        <TextField
                          size="small"
                          placeholder="domain.com"
                          value={newPermissionDomain}
                          onChange={(e) => setNewPermissionDomain(e.target.value)}
                          fullWidth
                          sx={{ fontFamily: T.font, '& .MuiOutlinedInput-root': { fontSize: '0.8125rem' }, '& .MuiInputBase-input': { py: 0.5 } }}
                        />
                      ) : (
                        <TextField
                          size="small"
                          placeholder="user@domain.com"
                          value={newPermissionEmail}
                          onChange={(e) => setNewPermissionEmail(e.target.value)}
                          fullWidth
                          sx={{ fontFamily: T.font, '& .MuiOutlinedInput-root': { fontSize: '0.8125rem' }, '& .MuiInputBase-input': { py: 0.5 } }}
                        />
                      )}
                    </Box>
                    <Box sx={{ width: '28%', minWidth: 120 }}>
                      <FormControl size="small" fullWidth sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.8125rem', '& .MuiSelect-select': { py: 0.5 } } }}>
                        <Select value={newPermissionRole} onChange={(e) => setNewPermissionRole(e.target.value as 'reader' | 'commenter' | 'writer')}>
                          <MenuItem value="reader">Viewer</MenuItem>
                          <MenuItem value="commenter">Commenter</MenuItem>
                          <MenuItem value="writer">Editor</MenuItem>
                        </Select>
                      </FormControl>
                    </Box>
                    <Box sx={{ width: 88, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
                      <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textTertiary(t) }}>—</Typography>
                    </Box>
                    <Box sx={{ width: 72, flexShrink: 0, display: 'flex', justifyContent: 'center', gap: 0.5 }}>
                      <Tooltip title="Cancel">
                        <IconButton size="small" onClick={() => { setAddPermissionDialogOpen(false); setNewPermissionEmail(''); setNewPermissionDomain(''); }} aria-label="Cancel">
                          <X size={18} strokeWidth={1.75} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Add">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={handleAddFilePermission}
                          disabled={!((newPermissionType === 'user' && newPermissionEmail.trim()) || (newPermissionType === 'domain' && newPermissionDomain.trim()) || newPermissionType === 'anyone')}
                          aria-label="Add"
                        >
                          <Check size={18} strokeWidth={1.75} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                ) : (
                  <Box sx={(t) => ({ px: 2, py: 1, borderTop: (selectedFile.permissions ?? []).length > 0 ? `1px solid ${pick(t, T.borderSubtle, '#27272a')}` : 'none' })}>
                    <Tooltip title="Add user or group">
                      <IconButton size="small" color="primary" onClick={() => setAddPermissionDialogOpen(true)} aria-label="Add permission">
                        <Plus size={16} strokeWidth={1.75} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                )}
              </ListShell>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, borderTop: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}`, gap: 1 }}>
          {selectedPermission && (
            <Button
              variant="contained"
              onClick={handleUpdatePermission}
              sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, bgcolor: T.accent, '&:hover': { bgcolor: T.accentHover }, px: 2.5, mr: 'auto' }}
            >
              Update Role
            </Button>
          )}
          <Button onClick={() => { setPermissionDialogOpen(false); setSelectedPermissionIds(new Set()); }} sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, color: (t) => textSecondary(t), '&:hover': { bgcolor: (t) => pick(t, '#f0f0ec', '#27272a') } }}>
            Done
          </Button>
        </DialogActions>
      </Dialog>

        <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar((s) => ({ ...s, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <Alert onClose={() => setSnackbar((s) => ({ ...s, open: false }))} severity={snackbar.severity} sx={{ width: '100%', fontFamily: T.font, borderRadius: T.radius, alignItems: 'center' }}>
            {snackbar.message}
          </Alert>
        </Snackbar>
      </Box>
    );
  }
