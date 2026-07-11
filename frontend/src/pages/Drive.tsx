import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
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
  Autocomplete,
  IconButton,
  Button,
  Tooltip,
  Popover,
  Checkbox,
  FormControlLabel,
  Alert,
  Snackbar,
  TablePagination,
  Divider,
  useMediaQuery,
} from '@mui/material';
import {
  Search,
  Trash2,
  SlidersHorizontal,
  X,
  Ban,
  RefreshCw,
  Calendar,
  ExternalLink,
  Plus,
  Check,
  Play,
  Folder,
} from 'lucide-react';
import { apiClient } from '../services/api.client';
import { getApiErrorMessage } from '../utils/apiError';
import { ExportButton } from '../components/ExportButton';
import { DateRangeCalendar } from '../components/DateRangeCalendar';
import { ActionTooltip } from '../components/ActionTooltip';
import { T, pick, selectMenuProps, textSecondary, textTertiary, exportToolbarButtonSx, dialogPaperSx, TOOLBAR_ICON } from '../theme/designTokens';
import { tablePaginationProps } from '../components/ui/tablePaginationProps';
import { ColumnHeader } from '../components/ui/ColumnHeader';
import { ListShell, ListHeaderRow, ListDataRow, listCheckboxSx, listActionsSx } from '../components/ui/ListShell';
import { ListChevron } from '../components/ui/ListChevron';
import { useResizableColumns } from '../hooks/useResizableColumns';
import { DialogListPagination, DIALOG_LIST_PAGE_SIZE } from '../components/ui/DialogListPagination';
import { DIALOG_LIST_SORT, dialogListNoopSort } from '../components/ui/dialogListSort';
import { DotLabel, ExternalChip } from '../components/StatusDot';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { FilterToken } from '../components/ui/FilterToken';
import { FlyoutSearch, type FlyoutSearchHandle } from '../components/ui/FlyoutSearch';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { useTheme } from '@mui/material/styles';

const DRIVE_STATIC_SORT = { key: '_', direction: 'asc' as const };
const driveNoopSort = () => {};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Tab indices for the Drive page.
const TAB_EXTERNAL = 0;
const TAB_PUBLIC = 1;
const TAB_FILES = 2;

const ROLE_LABEL: Record<string, string> = { reader: 'Viewer', commenter: 'Commenter', writer: 'Editor', owner: 'Owner' };

function normalizeEmailInput(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (EMAIL_RE.test(trimmed)) return trimmed;
  const inParens = trimmed.match(/\(([^\s@]+@[^\s@]+\.[^\s@]+)\)\s*$/)?.[1];
  return inParens || '';
}

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
  driveId?: string;
  permissions: Array<{
    id: string;
    type: string;
    role: string;
    emailAddress?: string;
    domain?: string;
    displayName?: string;
  }>;
}

// A single exposed-file record from the cached scan report.
interface ScanRecord {
  file: {
    id: string;
    name: string;
    mimeType: string;
    owner: string;
    ownerName?: string;
    path: string;
    driveId?: string;
    driveName?: string;
    webViewLink: string;
    modifiedTime: string;
  };
  exposure: 'public' | 'external';
  isPublic: boolean;
  publicRoles: string[];
  externalDomains: string[];
  externalEmails: string[];
  externalGroups: string[];
}

interface ScanStatus {
  status: 'never-scanned' | 'running' | 'completed' | 'failed';
  lastScan: string | null;
  coverage?: { usersTotal: number; usersDone: number; sharedDrivesTotal: number; sharedDrivesDone: number };
  counts?: { public: number; external: number; total: number };
  error?: string;
}

/** Search-tab filters only — must match what /drive/search accepts. */
interface DriveFilters {
  owner: string;
  mimeType: string;
  createdFrom: string;
  createdTo: string;
  modifiedFrom: string;
  modifiedTo: string;
  nameContains: string;
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
// Classify a permission as external using the org's authoritative allowed-domain
// list (sourced from /auth/me) rather than a hardcoded default. Owners are never
// external, and when the domain list is unknown we don't flag (avoids labelling
// the owner / internal users as external in the modal).
function isPermissionExternal(
  perm: { type: string; role?: string; domain?: string; emailAddress?: string },
  allowedDomains: string[]
): boolean {
  if (perm.role === 'owner') return false;
  if (perm.type === 'anyone') return true;
  const domains = allowedDomains.map((d) => d.toLowerCase()).filter(Boolean);
  if (domains.length === 0) return false;
  if (perm.type === 'domain' && perm.domain) return !domains.includes(perm.domain.toLowerCase());
  if ((perm.type === 'user' || perm.type === 'group') && perm.emailAddress) {
    const domain = perm.emailAddress.split('@')[1]?.toLowerCase();
    return !!domain && !domains.includes(domain);
  }
  return false;
}

// Concise "shared with" summary for an external record: individual principals
// first, plus any domain-wide shares not already implied by a listed email.
function sharedWithLabel(record: ScanRecord): string {
  const principals = [...record.externalEmails, ...record.externalGroups];
  const coveredDomains = new Set(principals.map((p) => p.split('@')[1]?.toLowerCase()).filter(Boolean));
  const domains = record.externalDomains.filter((d) => !coveredDomains.has(d.toLowerCase()));
  const parts = [...principals, ...domains.map((d) => `${d} (domain)`)];
  return parts.length ? parts.join(', ') : '—';
}

function publicAccessLabel(record: ScanRecord): string {
  const roles = (record.publicRoles || []).map((r) => ROLE_LABEL[r] || r);
  const unique = Array.from(new Set(roles));
  return unique.length ? `Anyone (${unique.join('/')})` : 'Anyone with link';
}

export function Drive() {
  const muiTheme = useTheme();
  const isMdUp = useMediaQuery(muiTheme.breakpoints.up('md'));
  const [tabValue, setTabValue] = useState(TAB_EXTERNAL);
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  // Cached-scan report state (External Shares + Public Links tabs).
  const [reportRecords, setReportRecords] = useState<ScanRecord[]>([]);
  const [reportTotal, setReportTotal] = useState(0);
  const [reportCounts, setReportCounts] = useState<{ public: number; external: number; total: number }>({ public: 0, external: 0, total: 0 });
  const [reportLoading, setReportLoading] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [scanTriggering, setScanTriggering] = useState(false);

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [filters, setFilters] = useState<DriveFilters>({
    owner: '',
    mimeType: '',
    createdFrom: '',
    createdTo: '',
    modifiedFrom: '',
    modifiedTo: '',
    nameContains: '',
  });
  const [trashing, setTrashing] = useState(false);
  const [externalSearchTerm, setExternalSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filtersVisible, setFiltersVisible] = useState(false);

  // v2: no Actions column — role is an inline select; delete via checkbox bulk.
  // Type weight keeps the add-row Select readable ("User") without crowding email.
  const permCols = useResizableColumns(
    'drive-file-perms-v3',
    { type: 100, name: 140, email: 200, access: 96, role: 128 },
    { type: 0, name: 0, email: 0, access: 0, role: 0 }
  );
  const searchCols = useResizableColumns(
    'drive-search',
    { name: 240, owner: 180, created: 110, modified: 110, size: 88, location: 160 },
    { name: 140, owner: 120, created: 80, modified: 80, size: 64, location: 100 },
    { resizableIds: ['name'] }
  );
  const auditCols = useResizableColumns(
    'drive-external',
    { name: 240, owner: 180, sharedWith: 220, modified: 110, location: 160 },
    { name: 140, owner: 120, sharedWith: 140, modified: 80, location: 100 },
    { resizableIds: ['name'] }
  );

  // Drive Search tab (org-wide, on-demand — no auto-load).
  const [searchDriveId, setSearchDriveId] = useState('');
  const [includeTrashed, setIncludeTrashed] = useState(false);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchMeta, setSearchMeta] = useState<{
    matched: number; truncated: boolean; scope: string;
    usersScanned?: number; usersTotal?: number; sharedDrivesScanned?: number; durationMs: number;
  } | null>(null);
  const [sharedDrivesList, setSharedDrivesList] = useState<Array<{ id: string; name: string }>>([]);
  const searchFlyoutRef = useRef<FlyoutSearchHandle>(null);
  const exportCSVRef = useRef<() => void | Promise<void>>(() => {});
  const exportSelectedCSVRef = useRef<() => void | Promise<void>>(() => {});
  const exportExternalSharingRef = useRef<() => void | Promise<void>>(() => {});
  const exportExternalSelectedCSVRef = useRef<() => void | Promise<void>>(() => {});
  const [createdDateAnchor, setCreatedDateAnchor] = useState<HTMLElement | null>(null);
  const [modifiedDateAnchor, setModifiedDateAnchor] = useState<HTMLElement | null>(null);
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<Set<string>>(new Set());
  const [addPermissionDialogOpen, setAddPermissionDialogOpen] = useState(false);
  const [newPermissionType, setNewPermissionType] = useState<'user' | 'domain' | 'anyone'>('user');
  const [newPermissionRole, setNewPermissionRole] = useState<'reader' | 'commenter' | 'writer'>('reader');
  const [newPermissionEmail, setNewPermissionEmail] = useState('');
  const [newPermissionDomain, setNewPermissionDomain] = useState('');
  const [directorySuggestions, setDirectorySuggestions] = useState<string[]>([]);
  const [directoryNameByEmail, setDirectoryNameByEmail] = useState<Record<string, string>>({});
  const [directoryLoaded, setDirectoryLoaded] = useState(false);
  const [loadingDirectoryUsers, setLoadingDirectoryUsers] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' | 'warning' }>({
    open: false,
    message: '',
    severity: 'success',
  });
  const [filePermissionsPage, setFilePermissionsPage] = useState(0);
  const [filePermissionsRowsPerPage, setFilePermissionsRowsPerPage] = useState(DIALOG_LIST_PAGE_SIZE);

  const isFilesTab = tabValue === TAB_FILES;
  const isAuditTab = tabValue === TAB_EXTERNAL || tabValue === TAB_PUBLIC;
  const auditCategory: 'external' | 'public' = tabValue === TAB_PUBLIC ? 'public' : 'external';

  // Load the org's authoritative internal-domain list once, for classifying
  // Drive permissions as internal/external in the permissions modal.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get('/auth/me')
      .then((r) => { if (!cancelled) setAllowedDomains(Array.isArray(r.data?.allowedDomains) ? r.data.allowedDomains : []); })
      .catch(() => { /* non-fatal: modal falls back to not flagging */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!permissionDialogOpen) return;
    setFilePermissionsPage(0);
  }, [permissionDialogOpen, selectedFile?.id]);

  useEffect(() => {
    const n = selectedFile?.permissions?.length ?? 0;
    const max = Math.max(0, Math.ceil(n / filePermissionsRowsPerPage) - 1);
    setFilePermissionsPage((p) => Math.min(p, max));
  }, [selectedFile?.permissions?.length, selectedFile?.id, filePermissionsRowsPerPage]);

  // Drive permissions.list often omits displayName — hydrate from Directory when the modal opens.
  useEffect(() => {
    if (!permissionDialogOpen || loadingDirectoryUsers || directoryLoaded) return;
    const fetchDirectoryUsers = async () => {
      try {
        setLoadingDirectoryUsers(true);
        const response = await apiClient.get('/users?maxResults=500');
        const uniqueByEmail = new Map<string, string>();
        const names: Record<string, string> = {};
        if (Array.isArray(response.data)) {
          for (const user of response.data) {
            const email = String(user?.primaryEmail || '').trim();
            if (!EMAIL_RE.test(email)) continue;
            const fullName = String(user?.name?.fullName || '').trim();
            uniqueByEmail.set(email, fullName ? `${fullName} (${email})` : email);
            if (fullName) names[email.toLowerCase()] = fullName;
          }
        }
        setDirectorySuggestions(Array.from(uniqueByEmail.values()).sort((a, b) => a.localeCompare(b)));
        setDirectoryNameByEmail(names);
      } catch (error) {
        console.error('Error fetching users for Drive permission suggestions:', error);
        setDirectorySuggestions([]);
      } finally {
        setDirectoryLoaded(true);
        setLoadingDirectoryUsers(false);
      }
    };
    void fetchDirectoryUsers();
  }, [permissionDialogOpen, loadingDirectoryUsers, directoryLoaded]);

  const fetchScanStatus = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/audit/external-scan/status');
      setScanStatus(data);
      return data as ScanStatus;
    } catch (error) {
      console.error('Error fetching scan status:', error);
      return null;
    }
  }, []);

  const fetchReport = useCallback(async () => {
    try {
      setReportLoading(true);
      const params = new URLSearchParams({
        category: auditCategory,
        page: String(page + 1),
        pageSize: String(rowsPerPage),
      });
      if (debouncedSearch.trim()) params.append('search', debouncedSearch.trim());
      const { data } = await apiClient.get(`/audit/external-scan/report?${params.toString()}`);
      setReportRecords(Array.isArray(data.records) ? data.records : []);
      setReportTotal(data.total || 0);
      if (data.counts) setReportCounts(data.counts);
      setScanStatus((prev) => ({
        status: data.status || prev?.status || 'never-scanned',
        lastScan: data.lastScan ?? prev?.lastScan ?? null,
        coverage: data.coverage ?? prev?.coverage,
        counts: data.counts ?? prev?.counts,
      }));
      setLoadError(null);
    } catch (error: any) {
      console.error('Error fetching scan report:', error);
      setReportRecords([]);
      setReportTotal(0);
      setLoadError(getApiErrorMessage(error, 'Failed to load external sharing report.'));
    } finally {
      setReportLoading(false);
    }
  }, [auditCategory, page, rowsPerPage, debouncedSearch]);

  // Debounce the audit search box.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(externalSearchTerm), 400);
    return () => clearTimeout(id);
  }, [externalSearchTerm]);

  // Load report/status when on an audit tab. The Drive Search tab is on-demand
  // (an org-wide fan-out is too expensive to auto-run), so it loads only when
  // the admin explicitly runs a search.
  useEffect(() => {
    if (isAuditTab) {
      void fetchScanStatus();
      void fetchReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabValue, page, rowsPerPage, debouncedSearch]);

  // Populate the shared-drive picker for the Drive Search tab (once).
  useEffect(() => {
    if (!isFilesTab || sharedDrivesList.length > 0) return;
    (async () => {
      try {
        const { data } = await apiClient.get('/drive/shared-drives');
        const list = Array.isArray(data) ? data : (data?.drives || []);
        setSharedDrivesList(list.map((d: any) => ({ id: d.id, name: d.name || d.id })));
      } catch {
        // Non-fatal: the picker just stays empty.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFilesTab]);

  // Poll status while a scan is running; refresh the report when it finishes.
  useEffect(() => {
    if (scanStatus?.status !== 'running') return;
    const id = setInterval(async () => {
      const next = await fetchScanStatus();
      if (next && next.status !== 'running') {
        clearInterval(id);
        if (isAuditTab) void fetchReport();
        setSnackbar({
          open: true,
          message: next.status === 'completed' ? 'Scan completed.' : `Scan ${next.status}.`,
          severity: next.status === 'completed' ? 'success' : 'error',
        });
      }
    }, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanStatus?.status]);

  useEffect(() => {
    // Reset to first page when filters change
    setPage(0);
  }, [filters]);

  useEffect(() => {
    setPage(0);
    setSelectedFiles(new Set());
  }, [debouncedSearch, tabValue]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchFlyoutRef.current?.focus();
      }
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setFiltersVisible((v) => !v);
      }
      if (isAuditTab) {
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
      if (isFilesTab) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
          e.preventDefault();
          e.stopPropagation();
          const fn = selectedFiles.size > 0 ? exportSelectedCSVRef.current : exportCSVRef.current;
          if (typeof fn === 'function') fn();
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
          e.preventDefault();
          if (selectedFiles.size > 0) handleExportSelectedDrive();
          else handleExportAllDrive();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabValue, selectedFiles.size]);

  const handleTriggerScan = async () => {
    try {
      setScanTriggering(true);
      const { data } = await apiClient.post('/audit/external-scan/run', {});
      setScanStatus({ status: 'running', lastScan: scanStatus?.lastScan ?? null, coverage: { usersTotal: 0, usersDone: 0, sharedDrivesTotal: 0, sharedDrivesDone: 0 } });
      setSnackbar({ open: true, message: `Scan started (${data.scanId}). This can take a while for large orgs.`, severity: 'info' });
      void fetchScanStatus();
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 409) {
        setSnackbar({ open: true, message: 'A scan is already running.', severity: 'info' });
        void fetchScanStatus();
      } else if (status === 501) {
        setSnackbar({ open: true, message: getApiErrorMessage(error, 'Async scanning is not configured on this deployment.'), severity: 'warning' });
      } else {
        setSnackbar({ open: true, message: getApiErrorMessage(error, 'Failed to start scan.'), severity: 'error' });
      }
    } finally {
      setScanTriggering(false);
    }
  };

  // Map the Drive Search inputs to the org-wide /drive/search endpoint. Only
  // criteria the search API can push down to Drive's `q` are sent.
  const buildSearchParams = () => {
    const params = new URLSearchParams();
    const text = filters.nameContains.trim();
    if (text) params.append('text', text);
    if (filters.owner.trim()) params.append('owner', filters.owner.trim());
    if (searchDriveId) params.append('driveId', searchDriveId);
    if (filters.mimeType) params.append('mimeType', filters.mimeType);
    if (filters.modifiedFrom) params.append('modifiedAfter', filters.modifiedFrom);
    if (filters.modifiedTo) params.append('modifiedBefore', filters.modifiedTo);
    if (filters.createdFrom) params.append('createdAfter', filters.createdFrom);
    if (filters.createdTo) params.append('createdBefore', filters.createdTo);
    if (includeTrashed) params.append('includeTrashed', 'true');
    return params;
  };

  /** Admin-centric full path from backend. */
  const getFileLocationLabel = (file: { path?: string }): string => {
    const path = file.path?.trim();
    return path || 'Unresolved';
  };

  // Org-wide Drive search (on-demand). Fans out across users/shared drives via
  // the backend; owner/shared-drive inputs hit the one-query fast path.
  const runDriveSearch = async () => {
    const params = buildSearchParams();
    if (!params.toString()) {
      setSnackbar({ open: true, message: 'Enter a search term or filter first.', severity: 'info' });
      return;
    }
    try {
      setSearching(true);
      setLoading(true);
      const { data } = await apiClient.get(`/drive/search?${params.toString()}`);
      setFiles(Array.isArray(data.files) ? data.files : []);
      setSearchMeta({
        matched: data.matched ?? 0,
        truncated: !!data.truncated,
        scope: data.scope || 'org',
        usersScanned: data.usersScanned,
        usersTotal: data.usersTotal,
        sharedDrivesScanned: data.sharedDrivesScanned,
        durationMs: data.durationMs ?? 0,
      });
      setHasSearched(true);
      setSelectedFiles(new Set());
      setPage(0);
      setLoadError(null);
    } catch (error: any) {
      console.error('Error searching Drive:', error);
      setFiles([]);
      setLoadError(getApiErrorMessage(error, 'Drive search failed.'));
      setSnackbar({
        open: true,
        message: getApiErrorMessage(error, 'Drive search failed.'),
        severity: 'error',
      });
    } finally {
      setSearching(false);
      setLoading(false);
    }
  };

  // Refresh whichever dataset the current tab is showing.
  const refreshCurrent = () => {
    if (isFilesTab) { if (hasSearched) void runDriveSearch(); }
    else void fetchReport();
  };

  const handleFilterChange = (key: keyof DriveFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({
      owner: '',
      mimeType: '',
      createdFrom: '',
      createdTo: '',
      modifiedFrom: '',
      modifiedTo: '',
      nameContains: '',
    });
    setSearchDriveId('');
    setIncludeTrashed(false);
  };

  /** Move selected search-result files to Drive Trash (super admin API). */
  const handleTrashSelected = async () => {
    if (selectedFiles.size === 0 || !isFilesTab) return;
    const n = selectedFiles.size;
    if (
      !window.confirm(
        `Move ${n} file(s) to Trash? They can be restored from Google Drive Trash. This does not permanently delete immediately.`
      )
    ) {
      return;
    }
    try {
      setTrashing(true);
      const { data } = await apiClient.post('/drive/files/trash', {
        fileIds: Array.from(selectedFiles),
      });
      const succeeded: string[] = data?.succeeded || [];
      const failed: Array<{ fileId: string; error: string }> = data?.failed || [];
      setFiles((prev) => prev.filter((f) => !succeeded.includes(f.id)));
      setSelectedFiles(new Set());
      if (failed.length === 0) {
        setSnackbar({ open: true, message: `${succeeded.length} file(s) moved to Trash.`, severity: 'success' });
      } else {
        setSnackbar({
          open: true,
          message: `Trashed ${succeeded.length}; ${failed.length} failed. ${failed[0]?.error || ''}`.trim(),
          severity: 'warning',
        });
      }
    } catch (error: any) {
      setSnackbar({
        open: true,
        message: getApiErrorMessage(error, 'Failed to trash file(s).'),
        severity: 'error',
      });
    } finally {
      setTrashing(false);
    }
  };

  const hasActiveFilters = () => {
    return Object.values(filters).some(v => v && v.trim() !== '') || !!searchDriveId || includeTrashed;
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

  const handleSelectAllReport = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      setSelectedFiles(new Set(reportRecords.map((r) => r.file.id).filter(Boolean)));
    } else {
      setSelectedFiles(new Set());
    }
  };

  const handleOpenPermissionDialogForRecord = async (record: ScanRecord) => {
    const fileId = record.file?.id;
    if (!fileId) return;
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
        driveId: data.driveId,
      };
      setSelectedFile(file);
      setPermissionDialogOpen(true);
    } catch (err: any) {
      console.error(err);
      setSnackbar({ open: true, message: getApiErrorMessage(err, 'Failed to load file for permissions.'), severity: 'error' });
    }
  };

  // Per-tab bulk remediation: strip external collaborators or public links.
  const handleBulkRemediate = async () => {
    if (selectedFiles.size === 0) return;
    const mode = auditCategory; // 'external' | 'public'
    const label = mode === 'public' ? 'public (Anyone with link) access' : 'external collaborator access';
    if (!confirm(`Remove ${label} from ${selectedFiles.size} file(s)? This cannot be undone.`)) return;

    try {
      setBulkActionLoading(true);
      const response = await apiClient.post('/audit/external-scan/remediate', {
        fileIds: Array.from(selectedFiles),
        mode,
      });
      const { success, failed } = response.data;
      setSelectedFiles(new Set());
      void fetchReport();
      if (failed === 0) {
        setSnackbar({ open: true, message: `Removed ${label} from ${success} file(s).`, severity: 'success' });
      } else {
        setSnackbar({ open: true, message: `Updated ${success} file(s), ${failed} failed (some access may be inherited from a Shared Drive).`, severity: 'warning' });
      }
    } catch (error: any) {
      console.error('Error remediating shares:', error);
      setSnackbar({ open: true, message: getApiErrorMessage(error, 'Failed to remediate shares.'), severity: 'error' });
    } finally {
      setBulkActionLoading(false);
    }
  };

  // Export the current Drive Search results (client-side over the loaded set).
  const handleExportCSV = async () => {
    if (files.length === 0) {
      setSnackbar({ open: true, message: 'Run a search first.', severity: 'info' });
      return;
    }
    const csvData = files.map((file) => ({
      'File Name': file.name,
      'File ID': file.id,
      'Owner': file.owners.map((o: any) => o.emailAddress).join('; '),
      'Type': file.mimeType,
      'Created Date': file.createdTime || '',
      'Modified Date': file.modifiedTime || '',
      'Size (bytes)': file.size || '',
      'Shared': file.shared ? 'Yes' : 'No',
      'Location': file.path || '',
      'Link': file.webViewLink,
    }));
    const headers = Object.keys(csvData[0] || {});
    const csv = [
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
    const blob = new Blob([csv], { type: 'text/csv' });
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `drive-search-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
    setSnackbar({ open: true, message: 'CSV downloading now.', severity: 'success' });
  };

  const handleOpenPermissionDialog = async (file: DriveFile) => {
    // Open immediately with list-state data so the modal feels instant
    setSelectedFile(file);
    setPermissionDialogOpen(true);

    // Then silently refresh with fresh data (correct path + up-to-date permissions)
    try {
      const { data } = await apiClient.get<DriveFile>(`/drive/files/${file.id}`);
      setSelectedFile((prev) => (prev?.id === file.id ? data : prev));
    } catch {
      // keep the list-state fallback already set above
    }
  };

  const handleUpdatePermission = async (permissionId: string, role: string) => {
    if (!selectedFile) return;

    try {
      await apiClient.patch(`/drive/files/${selectedFile.id}/permissions/${permissionId}`, { role });
      setSelectedFile((prev) => {
        if (!prev || prev.id !== selectedFile.id) return prev;
        return {
          ...prev,
          permissions: (prev.permissions ?? []).map((p) => (p.id === permissionId ? { ...p, role } : p)),
        };
      });
      await refreshCurrent();
      setSnackbar({ open: true, message: 'Role updated.', severity: 'success' });
    } catch (error) {
      console.error('Error updating permission:', error);
      setSnackbar({ open: true, message: getApiErrorMessage(error, 'Failed to update permission. Please try again.'), severity: 'error' });
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
    const normalizedPermissionEmail = normalizeEmailInput(newPermissionEmail);
    if (newPermissionType === 'user' && !normalizedPermissionEmail) {
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
        ...(newPermissionType === 'user' && { emailAddress: normalizedPermissionEmail }),
        ...(newPermissionType === 'domain' && { domain: newPermissionDomain.trim() }),
      });
      await refreshSelectedFilePermissions();
      setAddPermissionDialogOpen(false);
      setNewPermissionEmail('');
      setNewPermissionDomain('');
      setSnackbar({ open: true, message: 'Permission added successfully', severity: 'success' });
      refreshCurrent();
    } catch (error: any) {
      console.error('Error adding permission:', error);
      setSnackbar({
        open: true,
        message: getApiErrorMessage(error, 'Failed to add permission'),
        severity: 'error',
      });
    }
  };

  const handleBulkRemovePermissions = async () => {
    if (!selectedFile || selectedPermissionIds.size === 0) return;
    const perms = (selectedFile.permissions ?? []).filter((p) => selectedPermissionIds.has(p.id) && p.role !== 'owner');
    if (perms.length === 0) return;
    if (!confirm(`Remove ${perms.length} permission(s)?`)) return;
    const driveId = selectedFile.driveId;
    const succeeded: string[] = [];
    const errors: string[] = [];

    for (const p of perms) {
      try {
        await apiClient.delete(`/drive/files/${selectedFile.id}/permissions/${p.id}`, {
          params: driveId ? { driveId } : undefined,
        });
        succeeded.push(p.id);
      } catch (error: any) {
        errors.push(getApiErrorMessage(error, `Failed to remove permission ${p.id}`));
      }
    }

    if (succeeded.length > 0) {
      const removed = new Set(succeeded);
      setSelectedFile((prev) =>
        prev && prev.id === selectedFile.id
          ? { ...prev, permissions: (prev.permissions ?? []).filter((p) => !removed.has(p.id)) }
          : prev
      );
      setSelectedPermissionIds((prev) => {
        const next = new Set(prev);
        succeeded.forEach((id) => next.delete(id));
        return next;
      });
      refreshCurrent();
    }

    if (errors.length > 0) {
      // Show first unique error — typically all inherited errors share the same message
      setSnackbar({ open: true, message: errors[0], severity: 'error' });
    } else {
      setSnackbar({ open: true, message: `${succeeded.length} permission(s) removed`, severity: 'success' });
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

  // --- Audit (report) exports -------------------------------------------------
  const handleExportExternalSharing = async () => {
    try {
      const params = new URLSearchParams({ category: auditCategory });
      if (debouncedSearch.trim()) params.append('search', debouncedSearch.trim());
      const response = await apiClient.get(`/audit/external-scan/report/export?${params.toString()}`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'text/csv' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `${auditCategory === 'public' ? 'public-links' : 'external-sharing'}-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      setSnackbar({ open: true, message: 'CSV downloading now.', severity: 'success' });
    } catch (error) {
      console.error('Error exporting report:', error);
      setSnackbar({ open: true, message: 'Export failed. Please try again.', severity: 'error' });
    }
  };

  const handleExportExternalSelectedCSV = async () => {
    if (selectedFiles.size === 0) return;
    const selected = reportRecords.filter((r) => selectedFiles.has(r.file.id));
    if (selected.length === 0) return;
    const csvData = selected.map((r) => ({
      'File Name': r.file.name,
      'Owner': r.file.owner,
      'Location': r.file.path,
      'Exposure': r.exposure === 'public' ? 'Public (Anyone with link)' : 'External',
      'Public Access': r.isPublic ? publicAccessLabel(r) : 'No',
      'Shared With': sharedWithLabel(r),
      'Modified': r.file.modifiedTime,
      'Link': r.file.webViewLink,
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
    link.download = `${auditCategory === 'public' ? 'public-links' : 'external-sharing'}-selected-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
    setSnackbar({ open: true, message: 'Selected files exported.', severity: 'success' });
  };

  const handleExportSelectedCSV = async () => {
    if (selectedFiles.size === 0) return;
    const selected = files.filter((f) => selectedFiles.has(f.id));
    const csvData = selected.map((file) => ({
      'File Name': file.name,
      'File ID': file.id,
      'Owner': file.owners.map((o: any) => o.emailAddress).join('; '),
      'Created Date': file.createdTime || '',
      'Modified Date': file.modifiedTime || '',
      'Size (bytes)': file.size || '',
      'Shared': file.shared ? 'Yes' : 'No',
      'Location': file.path || '',
      'Link': file.webViewLink,
    }));
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

  // Save the current Drive Search results to Google Drive (by id, so it exports
  // exactly what's on screen rather than re-listing the admin's own files).
  const handleExportAllDrive = async () => {
    if (files.length === 0) {
      setSnackbar({ open: true, message: 'Run a search first.', severity: 'info' });
      return;
    }
    try {
      const response = await apiClient.post('/drive/files/export/selected/drive', { fileIds: files.map((f) => f.id) });
      if (response.data?.webViewLink) window.open(response.data.webViewLink, '_blank');
      setSnackbar({ open: true, message: 'Saved to Google Drive.', severity: 'success' });
    } catch (err: any) {
      console.error(err);
      setSnackbar({ open: true, message: getApiErrorMessage(err, 'Drive export failed.'), severity: 'error' });
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
      setSnackbar({ open: true, message: getApiErrorMessage(err, 'Drive export failed.'), severity: 'error' });
    }
  };

  const handleExportExternalSharingDrive = async () => {
    try {
      const response = await apiClient.post('/audit/external-scan/report/export/drive', {
        category: auditCategory,
        ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
      });
      if (response.data?.webViewLink) window.open(response.data.webViewLink, '_blank');
      setSnackbar({ open: true, message: 'Report saved to Google Drive.', severity: 'success' });
    } catch (err: any) {
      console.error(err);
      setSnackbar({ open: true, message: getApiErrorMessage(err, 'Drive export failed.'), severity: 'error' });
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
    if (filters.createdFrom || filters.createdTo) labels.push({ key: 'createdFrom', label: `Created: ${formatFilterDateRange(filters.createdFrom, filters.createdTo)}` });
    if (filters.modifiedFrom || filters.modifiedTo) labels.push({ key: 'modifiedFrom', label: `Modified: ${formatFilterDateRange(filters.modifiedFrom, filters.modifiedTo)}` });
    return labels;
  }, [filters]);

  // Owners pinned to the top; otherwise original order preserved (stable via
  // index tiebreaker). Sort the full list before paginating.
  const allFilePerms = useMemo(() => {
    const perms = selectedFile?.permissions ?? [];
    return perms
      .map((p, i) => ({ p, i }))
      .sort((a, b) => (a.p.role === 'owner' ? 0 : 1) - (b.p.role === 'owner' ? 0 : 1) || a.i - b.i)
      .map((x) => x.p);
  }, [selectedFile?.id, selectedFile?.permissions]);
  const fpMaxPage = Math.max(0, Math.ceil(allFilePerms.length / filePermissionsRowsPerPage) - 1);
  const fpPageSafe = Math.min(filePermissionsPage, fpMaxPage);
  const pagedFilePermissions = useMemo(() => {
    const start = fpPageSafe * filePermissionsRowsPerPage;
    return allFilePerms.slice(start, start + filePermissionsRowsPerPage);
  }, [allFilePerms, fpPageSafe, filePermissionsRowsPerPage]);

  const lastScanAtLabel = useMemo(() => {
    if (!scanStatus || scanStatus.status === 'never-scanned' || !scanStatus.lastScan) return null;
    try {
      return new Date(scanStatus.lastScan).toLocaleString();
    } catch {
      return null;
    }
  }, [scanStatus]);

  const scanRunning = scanStatus?.status === 'running';
  const scanProgress = useMemo(() => {
    const cov = scanStatus?.coverage;
    if (!cov || !cov.usersTotal) return null;
    const total = cov.usersTotal + cov.sharedDrivesTotal;
    const done = cov.usersDone + cov.sharedDrivesDone;
    if (!total) return null;
    return Math.min(100, Math.round((done / total) * 100));
  }, [scanStatus]);

  const bulkRemediateLabel = auditCategory === 'public' ? 'Remove public access' : 'Remove external access';

  return (
    <Box sx={{ width: '100%', overflowY: 'auto', overflowX: 'hidden', fontFamily: T.font }}>
      <PageHeader
        title="Drive"
        status={
          isAuditTab ? (
            scanRunning ? (
              <>
                <Box component="span" className="page-status-live">
                  Scanning now
                  {scanProgress != null ? ` · ${scanProgress}%` : '…'}
                </Box>
                {scanStatus?.coverage?.usersTotal
                  ? ` · ${scanStatus.coverage.usersDone}/${scanStatus.coverage.usersTotal} users`
                  : null}
                {lastScanAtLabel ? (
                  <Box component="span" className="page-status-faint">
                    {` · Previous: ${lastScanAtLabel}`}
                  </Box>
                ) : null}
                {scanRunning && (
                  <LinearProgress
                    variant={scanProgress == null ? 'indeterminate' : 'determinate'}
                    value={scanProgress ?? undefined}
                    sx={(th) => ({
                      mt: 1.25,
                      height: 3,
                      borderRadius: 2,
                      maxWidth: 280,
                      bgcolor: pick(th, '#e8e8e4', '#27272a'),
                      '& .MuiLinearProgress-bar': { borderRadius: 2, bgcolor: T.accent },
                    })}
                  />
                )}
              </>
            ) : lastScanAtLabel ? (
              <>
                Last scan: {lastScanAtLabel}
                {typeof reportCounts.total === 'number' && scanStatus?.status !== 'never-scanned' ? (
                  <Box component="span" className="page-status-faint">
                    {` · ${reportCounts.external} external · ${reportCounts.public} public`}
                  </Box>
                ) : null}
              </>
            ) : (
              <Box component="span" className="page-status-faint">
                Never scanned — external and public shares won&apos;t appear until you run a scan
              </Box>
            )
          ) : undefined
        }
        actions={
          <>
            <SegmentedControl value={tabValue} options={['External Shares', 'Public Links', 'Drive Search']} onChange={(v) => { setTabValue(v); setSelectedFiles(new Set()); setPage(0); }} />
            {isAuditTab && (
              <Button
                size="small"
                variant="contained"
                onClick={handleTriggerScan}
                disabled={scanTriggering || scanRunning}
                startIcon={scanTriggering || scanRunning ? <CircularProgress size={14} color="inherit" /> : <Play size={15} strokeWidth={1.75} />}
                sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, height: 32, px: 2, bgcolor: T.accent, '&:hover': { bgcolor: T.accentHover } }}
              >
                {scanRunning ? 'Scanning…' : 'Run scan'}
              </Button>
            )}
          </>
        }
      />

      {isAuditTab && scanStatus?.status === 'never-scanned' && !scanRunning && !reportLoading && reportRecords.length === 0 ? (
        <EmptyState
          icon={<Folder size={22} strokeWidth={1.75} />}
          title="Scan Drive for exposure"
          description="Find files shared outside the org or with anyone-with-the-link access. One scan builds the report; re-run anytime after policy changes."
          actions={
            <Button
              size="small"
              variant="contained"
              onClick={handleTriggerScan}
              disabled={scanTriggering}
              startIcon={scanTriggering ? <CircularProgress size={14} color="inherit" /> : <Play size={15} strokeWidth={1.75} />}
              sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, height: 32, px: 2, bgcolor: T.accent, '&:hover': { bgcolor: T.accentHover } }}
            >
              Run first scan
            </Button>
          }
          hint="Org-wide · progress shows under the title while it runs"
          maxWidth={540}
        />
      ) : (
      <>
      {/* Toolbar: search + filters + export */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <FlyoutSearch
          ref={searchFlyoutRef}
          value={isAuditTab ? externalSearchTerm : filters.nameContains}
          onChange={(v) => (isAuditTab ? setExternalSearchTerm(v) : handleFilterChange('nameContains', v))}
          placeholder={
            isAuditTab
              ? auditCategory === 'public'
                ? 'Search public links…'
                : 'Search external shares…'
              : 'Search by file name… (Enter)'
          }
          tooltip={isAuditTab ? (auditCategory === 'public' ? 'Search public links' : 'Search external shares') : 'Search files'}
          onKeyDown={
            isFilesTab
              ? (e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void runDriveSearch();
                  }
                }
              : undefined
          }
        />

        {isFilesTab && (
          <Button
            size="small"
            variant="contained"
            onClick={() => void runDriveSearch()}
            disabled={searching}
            startIcon={searching ? <CircularProgress size={14} color="inherit" /> : <Search size={15} strokeWidth={1.75} />}
            sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, height: 32, px: 2, bgcolor: T.accent, '&:hover': { bgcolor: T.accentHover } }}
          >
            {searching ? 'Searching…' : 'Search'}
          </Button>
        )}

        {isFilesTab && (
          <ActionTooltip title="Filters">
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
              <SlidersHorizontal size={TOOLBAR_ICON.size} strokeWidth={TOOLBAR_ICON.strokeWidth} />
            </IconButton>
          </ActionTooltip>
        )}

        <ActionTooltip title="Refresh data">
          <IconButton
            size="small"
            onClick={refreshCurrent}
            aria-label="Refresh data"
            sx={{ color: (t: any) => textSecondary(t) }}
          >
            <RefreshCw size={TOOLBAR_ICON.size} strokeWidth={TOOLBAR_ICON.strokeWidth} />
          </IconButton>
        </ActionTooltip>

        <Box sx={{ flex: 1 }} />

        {selectedFiles.size > 0 && isAuditTab && (
          <Button
            size="small"
            variant="contained"
            color="error"
            onClick={handleBulkRemediate}
            disabled={bulkActionLoading}
            startIcon={bulkActionLoading ? <CircularProgress size={14} color="inherit" /> : <Ban size={15} strokeWidth={1.75} />}
            sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, height: 30, px: 1.5 }}
          >
            {bulkRemediateLabel} ({selectedFiles.size})
          </Button>
        )}

        {selectedFiles.size > 0 && isFilesTab && (
          <Button
            size="small"
            variant="contained"
            color="error"
            onClick={handleTrashSelected}
            disabled={trashing}
            startIcon={trashing ? <CircularProgress size={14} color="inherit" /> : <Trash2 size={15} strokeWidth={1.75} />}
            sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, height: 30, px: 1.5 }}
          >
            Move to Trash ({selectedFiles.size})
          </Button>
        )}

        {isAuditTab && (
          <ExportButton
            iconOnly={!isMdUp}
            tooltipTitle="Export report"
            totalItems={reportTotal}
            selectedCount={selectedFiles.size}
            hasFilters={false}
            onExportSelectedCSV={handleExportExternalSelectedCSV}
            onExportAllCSV={handleExportExternalSharing}
            onExportAllDrive={handleExportExternalSharingDrive}
            onExportSelectedDrive={handleExportExternalSharingDrive}
            onExportFilteredCSV={handleExportExternalSharing}
            onExportFilteredDrive={handleExportExternalSharingDrive}
            disabled={reportLoading}
            triggerSx={exportToolbarButtonSx()}
          />
        )}
        {isFilesTab && (
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

      {/* Drive Search refine panel (collapsible, Drive Search tab) */}
      {isFilesTab && (
        <>
          <Box sx={{ overflow: 'hidden', maxHeight: filtersVisible ? 360 : 0, transition: 'max-height 0.25s ease, opacity 0.2s ease', opacity: filtersVisible ? 1 : 0, mb: filtersVisible ? 2 : 0 }}>
            <Box sx={(theme: any) => ({
              display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center',
              p: 1.5, borderRadius: T.radius, border: `1px solid ${pick(theme, T.border, '#3f3f46')}`, bgcolor: pick(theme, T.surface, '#27272a'),
            })}>
              <TextField size="small" placeholder="Owner email (fast path)" value={filters.owner} onChange={(e) => handleFilterChange('owner', e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runDriveSearch(); } }}
                sx={{ fontFamily: T.font, '& .MuiOutlinedInput-root': { fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm }, maxWidth: 220 }} />
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <Select
                  value={filters.mimeType} displayEmpty
                  renderValue={(v) => DRIVE_MIME_OPTIONS.find((o) => o.value === v)?.label || 'Type'}
                  onChange={(e) => handleFilterChange('mimeType', e.target.value)}
                  MenuProps={selectMenuProps}
                  sx={{ fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm }}
                >
                  <MenuItem value="">Any type</MenuItem>
                  {DRIVE_MIME_OPTIONS.filter((o) => o.value).map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <Select
                  value={searchDriveId} displayEmpty
                  renderValue={(v) => (v ? (sharedDrivesList.find((d) => d.id === v)?.name || 'Shared drive') : 'Shared drive (fast path)')}
                  onChange={(e) => setSearchDriveId(e.target.value)}
                  MenuProps={selectMenuProps}
                  sx={{ fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm }}
                >
                  <MenuItem value="">Any drive</MenuItem>
                  {sharedDrivesList.map((d) => (
                    <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
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
              <FormControlLabel
                control={<Checkbox size="small" checked={includeTrashed} onChange={(e) => setIncludeTrashed(e.target.checked)} />}
                label={<Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t: any) => textSecondary(t) }}>Include trashed</Typography>}
              />
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

          {searchMeta && (
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
              <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>
                {`Found ${searchMeta.matched} file${searchMeta.matched === 1 ? '' : 's'}`}
                {searchMeta.scope === 'org' && typeof searchMeta.usersScanned === 'number'
                  ? ` · scanned ${searchMeta.usersScanned}/${searchMeta.usersTotal ?? '?'} users${searchMeta.sharedDrivesScanned ? ` + ${searchMeta.sharedDrivesScanned} shared drives` : ''}`
                  : searchMeta.scope === 'owner' ? ' · owner fast path'
                  : searchMeta.scope === 'shared-drive' ? ' · shared-drive fast path' : ''}
                {` · ${(searchMeta.durationMs / 1000).toFixed(1)}s`}
              </Typography>
              {searchMeta.truncated && (
                <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: '#f59e0b' }}>
                  Results capped — narrow your search (add an owner or shared drive) to see everything.
                </Typography>
              )}
            </Box>
          )}
        </>
      )}

      {loadError && !loading && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setLoadError(null)}>{loadError}</Alert>
      )}

      {isFilesTab && (
        <Box>
            {loading && (
              <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography sx={{ fontFamily: T.font, fontSize: '0.875rem', color: (t) => textSecondary(t) }}>
                  Searching Drives across the org…
                </Typography>
                <Box sx={{ flex: 1, maxWidth: 300 }}>
                  <LinearProgress variant="indeterminate" />
                </Box>
              </Box>
            )}

            <Box sx={{ overflowX: { xs: 'auto', md: 'visible' }, position: 'relative' }}>
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
                  <Checkbox
                    size="small"
                    indeterminate={selectedFiles.size > 0 && selectedFiles.size < files.length}
                    checked={files.length > 0 && selectedFiles.size === files.length}
                    onChange={handleSelectAll}
                    sx={{ p: 0.25, mr: 0.5, flexShrink: 0 }}
                  />
                  <ColumnHeader label="File Name" columnId="fn" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} {...searchCols.headerProps('name')} />
                  <Box sx={{ display: { xs: 'none', sm: 'flex' }, minWidth: 0 }}>
                    <ColumnHeader label="Owner" columnId="ow" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} {...searchCols.headerProps('owner')} />
                  </Box>
                  <Box sx={{ display: { xs: 'none', md: 'flex' }, minWidth: 0 }}>
                    <ColumnHeader label="Created" columnId="cr" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} {...searchCols.headerProps('created')} />
                  </Box>
                  <Box sx={{ display: { xs: 'none', lg: 'flex' }, minWidth: 0 }}>
                    <ColumnHeader label="Modified" columnId="mo" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} {...searchCols.headerProps('modified')} />
                  </Box>
                  <Box sx={{ display: { xs: 'none', sm: 'flex' }, minWidth: 0 }}>
                    <ColumnHeader label="Size" columnId="sz" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} {...searchCols.headerProps('size')} />
                  </Box>
                  <Box sx={{ display: { xs: 'none', sm: 'flex' }, minWidth: 0 }}>
                    <ColumnHeader label="Location" columnId="loc" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} {...searchCols.headerProps('location')} />
                  </Box>
                  <ColumnHeader label="" columnId="__open" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} width={36} align="right" pinEnd />
                </ListHeaderRow>
              {files.length === 0 ? (
                <Box sx={{ py: 6, textAlign: 'center', px: 2 }}>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>
                    {loading
                      ? 'Searching…'
                      : hasSearched
                        ? 'No files matched your search.'
                        : 'Search across every user’s Drive and all shared drives.'}
                  </Typography>
                  {!loading && !hasSearched && (
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textTertiary(t), mt: 1, maxWidth: 520, mx: 'auto' }}>
                      Type a file name and press Enter, or use Filters to target an owner or shared drive. Owner and shared-drive searches return instantly; a name-only search fans out across the whole org.
                    </Typography>
                  )}
                </Box>
              ) : (
                files.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map((file, fIdx, arr) => {
                  const isSelected = selectedFiles.has(file.id);
                  return (
                    <ListDataRow
                      key={file.id}
                      last={fIdx === arr.length - 1}
                      selected={isSelected}
                      onClick={() => handleOpenPermissionDialog(file)}
                    >
                      <Checkbox
                        size="small"
                        checked={isSelected}
                        onChange={() => handleSelectFile(file.id)}
                        onClick={(e) => e.stopPropagation()}
                        sx={{ p: 0.25, mr: 0.5, flexShrink: 0 }}
                      />
                      <Box sx={searchCols.cellSx('name')}>
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, color: (th) => pick(th, T.text, '#fafafa'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</Typography>
                      </Box>
                      <Box sx={{ ...searchCols.cellSx('owner'), display: { xs: 'none', sm: 'block' } }}>
                        {file.owners.map((owner) => (
                          <Typography key={owner.emailAddress} sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {owner.displayName || owner.emailAddress}
                          </Typography>
                        ))}
                      </Box>
                      <Box sx={{ ...searchCols.cellSx('created'), display: { xs: 'none', md: 'block' } }}>
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{file.createdTime ? new Date(file.createdTime).toLocaleDateString() : '—'}</Typography>
                      </Box>
                      <Box sx={{ ...searchCols.cellSx('modified'), display: { xs: 'none', lg: 'block' } }}>
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{new Date(file.modifiedTime).toLocaleDateString()}</Typography>
                      </Box>
                      <Box sx={{ ...searchCols.cellSx('size'), display: { xs: 'none', sm: 'block' } }}>
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{formatFileSize(file.size)}</Typography>
                      </Box>
                      <Box sx={{ ...searchCols.cellSx('location'), display: { xs: 'none', sm: 'block' } }}>
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{getFileLocationLabel(file)}</Typography>
                      </Box>
                      <Box sx={{ width: 36, flex: '0 0 36px', ml: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
                        <ListChevron />
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

      {isAuditTab && (
        <Box>
          {reportLoading && (
            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography sx={{ fontFamily: T.font, fontSize: '0.875rem', color: (t) => textSecondary(t) }}>
                Loading report…
              </Typography>
              <Box sx={{ flex: 1, maxWidth: 300 }}>
                <LinearProgress variant="indeterminate" />
              </Box>
            </Box>
          )}
          <Box sx={{ overflowX: { xs: 'auto', md: 'visible' }, position: 'relative' }}>
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
                <Checkbox
                  size="small"
                  indeterminate={(() => {
                    const selectedOnPage = reportRecords.filter((r) => selectedFiles.has(r.file.id)).length;
                    return selectedOnPage > 0 && selectedOnPage < reportRecords.length;
                  })()}
                  checked={reportRecords.length > 0 && reportRecords.every((r) => selectedFiles.has(r.file.id))}
                  onChange={handleSelectAllReport}
                  sx={{ p: 0.25, mr: 0.5, flexShrink: 0 }}
                />
                <ColumnHeader label="File Name" columnId="efn" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} {...auditCols.headerProps('name')} />
                <Box sx={{ display: { xs: 'none', sm: 'flex' }, minWidth: 0 }}>
                  <ColumnHeader label="Owner" columnId="eow" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} {...auditCols.headerProps('owner')} />
                </Box>
                <Box sx={{ display: { xs: 'none', md: 'flex' }, minWidth: 0 }}>
                  <ColumnHeader label={auditCategory === 'public' ? 'Access' : 'Shared With'} columnId="esw" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} {...auditCols.headerProps('sharedWith')} />
                </Box>
                <Box sx={{ display: { xs: 'none', lg: 'flex' }, minWidth: 0 }}>
                  <ColumnHeader label="Modified" columnId="emo" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} {...auditCols.headerProps('modified')} />
                </Box>
                <Box sx={{ display: { xs: 'none', sm: 'flex' }, minWidth: 0 }}>
                  <ColumnHeader label="Location" columnId="eloc" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} {...auditCols.headerProps('location')} />
                </Box>
                <ColumnHeader label="" columnId="__open" sortConfig={DRIVE_STATIC_SORT} onSort={driveNoopSort} sortable={false} width={36} align="right" pinEnd />
              </ListHeaderRow>
              {reportRecords.length === 0 ? (
                <Box sx={{ py: 6, textAlign: 'center' }}>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>
                    {reportLoading
                      ? 'Loading…'
                      : scanRunning
                        ? 'Updating report from previous scan… new findings appear when this run finishes.'
                        : auditCategory === 'public'
                          ? 'No public (Anyone with link) files found.'
                          : 'No externally shared files found.'}
                  </Typography>
                </Box>
              ) : (
                reportRecords.map((record, idx) => {
                  const f = record.file;
                  const id = f.id;
                  const isSelected = Boolean(id && selectedFiles.has(id));
                  return (
                    <ListDataRow
                      key={id || f.name}
                      last={idx === reportRecords.length - 1}
                      selected={isSelected}
                      onClick={() => handleOpenPermissionDialogForRecord(record)}
                    >
                      <Checkbox
                        size="small"
                        checked={isSelected}
                        onChange={() => handleSelectFile(id)}
                        onClick={(e) => e.stopPropagation()}
                        sx={{ p: 0.25, mr: 0.5, flexShrink: 0 }}
                      />
                      <Box sx={auditCols.cellSx('name')}>
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, color: (th) => pick(th, T.text, '#fafafa'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name ?? '—'}</Typography>
                      </Box>
                      <Box sx={{ ...auditCols.cellSx('owner'), display: { xs: 'none', sm: 'block' } }}>
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {f.ownerName || f.owner || '—'}
                        </Typography>
                      </Box>
                      <Box sx={{ ...auditCols.cellSx('sharedWith'), display: { xs: 'none', md: 'block' } }}>
                        {auditCategory === 'public' ? (
                          <DotLabel dotColor="#ef4444">{publicAccessLabel(record)}</DotLabel>
                        ) : (
                          <Tooltip title={sharedWithLabel(record)} placement="top">
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {sharedWithLabel(record)}
                            </Typography>
                          </Tooltip>
                        )}
                      </Box>
                      <Box sx={{ ...auditCols.cellSx('modified'), display: { xs: 'none', lg: 'block' } }}>
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '—'}</Typography>
                      </Box>
                      <Box sx={{ ...auditCols.cellSx('location'), display: { xs: 'none', sm: 'block' } }}>
                        <Tooltip title={f.path || ''} placement="top">
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {getFileLocationLabel(f)}
                          </Typography>
                        </Tooltip>
                      </Box>
                      <Box sx={{ width: 36, flex: '0 0 36px', ml: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
                        <ListChevron />
                      </Box>
                    </ListDataRow>
                  );
                })
              )}
            </ListShell>
          </Box>
          {reportTotal > 0 && (
            <TablePagination
              component="div"
              count={reportTotal}
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

      </>
      )}

      {/* Permission Management Dialog */}
      <Dialog
        open={permissionDialogOpen}
        onClose={() => {
          setPermissionDialogOpen(false);
          setSelectedPermissionIds(new Set());
        }}
        maxWidth={false}
        fullWidth
        PaperProps={{
          sx: (th) => ({
            ...dialogPaperSx(th),
            width: '100%',
            maxWidth: 720,
            overflowX: 'hidden',
          }),
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, pb: 1.5, borderBottom: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}` }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.02em', color: (t) => pick(t, T.text, '#fafafa'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedFile?.name}</Typography>
            <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textSecondary(t), mt: 0.25 }}>Manage Permissions</Typography>
          </Box>
          {selectedFile?.webViewLink && (
            <Button
              size="small"
              component="a"
              href={selectedFile.webViewLink}
              target="_blank"
              rel="noopener noreferrer"
              endIcon={<ExternalLink size={14} strokeWidth={1.75} />}
              sx={(th) => ({
                fontFamily: T.font,
                textTransform: 'none',
                borderRadius: T.radius,
                fontSize: '0.75rem',
                fontWeight: 500,
                height: 28,
                px: 1.25,
                flexShrink: 0,
                color: pick(th, T.text, '#e8eaed'),
                border: `1px solid ${pick(th, T.border, '#5f6368')}`,
                '&:hover': { borderColor: T.accent, bgcolor: pick(th, T.accentSoft, 'rgba(26, 115, 232, 0.12)') },
              })}
            >
              Open in Drive
            </Button>
          )}
        </DialogTitle>
        <DialogContent sx={{ pt: '20px !important', overflowX: 'hidden' }}>
          {selectedFile && (
            <Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 1.5, rowGap: 0.75 }}>
                <Box sx={{ minWidth: 0, flex: '1 1 140px' }}>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: (t) => textTertiary(t) }}>Type</Typography>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }} noWrap>{selectedFile.mimeType}</Typography>
                </Box>
                <Box sx={{ minWidth: 0, flex: '2 1 200px' }}>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: (t) => textTertiary(t) }}>Path</Typography>
                  <Typography sx={{ fontFamily: T.mono, fontSize: '0.75rem', color: (t) => textSecondary(t), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={selectedFile.path || '/My Drive'}>
                    {selectedFile.path || '/My Drive'}
                  </Typography>
                </Box>
              </Box>
              <Divider sx={{ my: 1.5 }} />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, minHeight: 32 }}>
                <Typography sx={{ fontFamily: T.font, fontWeight: 600, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: (t) => textTertiary(t) }}>
                  Permissions
                </Typography>
                <Box sx={{ flex: 1 }} />
                {selectedPermissionIds.size > 0 && (
                  <Button
                    size="small"
                    variant="contained"
                    color="error"
                    onClick={handleBulkRemovePermissions}
                    startIcon={<Trash2 size={15} strokeWidth={1.75} />}
                    sx={{
                      fontFamily: T.font,
                      textTransform: 'none',
                      borderRadius: T.radius,
                      fontSize: '0.8125rem',
                      fontWeight: 500,
                      height: 30,
                      px: 1.5,
                    }}
                  >
                    Remove {selectedPermissionIds.size} selected
                  </Button>
                )}
              </Box>
              <ListShell>
                <ListHeaderRow>
                  <Box sx={listCheckboxSx}>
                    {(selectedFile.permissions ?? []).filter((p) => p.role !== 'owner').length > 0 ? (
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
                    ) : null}
                  </Box>
                  <ColumnHeader label="Type" columnId="dt" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} {...permCols.headerProps('type')} />
                  <ColumnHeader label="Name" columnId="dn" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} {...permCols.headerProps('name')} />
                  <ColumnHeader label="Email" columnId="de" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} {...permCols.headerProps('email')} />
                  <ColumnHeader label="Access" columnId="dx" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} {...permCols.headerProps('access')} />
                  <ColumnHeader label="Role" columnId="dr" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} {...permCols.headerProps('role')} />
                </ListHeaderRow>
                {(selectedFile.permissions ?? []).length === 0 && !addPermissionDialogOpen && (
                  <Box sx={{ py: 4, textAlign: 'center' }}>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>No permissions found</Typography>
                  </Box>
                )}
                {pagedFilePermissions.map((permission, idx) => {
                  const isOwner = permission.role === 'owner';
                  const canSelect = !isOwner;
                  const isSelected = selectedPermissionIds.has(permission.id);
                  const allPerms = selectedFile.permissions ?? [];
                  const globalIdx = fpPageSafe * filePermissionsRowsPerPage + idx;
                  const isLastDataRow = globalIdx === allPerms.length - 1;
                  return (
                    <ListDataRow key={permission.id} last={isLastDataRow && addPermissionDialogOpen} selected={canSelect && isSelected}>
                      <Box sx={listCheckboxSx} onClick={(e) => e.stopPropagation()}>
                        {canSelect ? (
                          <Checkbox size="small" checked={isSelected} onChange={() => togglePermissionSelected(permission.id, isOwner)} sx={{ p: 0.25 }} />
                        ) : null}
                      </Box>
                      <Box sx={permCols.cellSx('type')}>
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{permission.type}</Typography>
                      </Box>
                      <Box sx={permCols.cellSx('name')}>
                        <Tooltip
                          title={
                            permission.type === 'anyone'
                              ? ''
                              : permission.displayName
                                || (permission.emailAddress
                                  ? directoryNameByEmail[permission.emailAddress.toLowerCase()] || ''
                                  : '')
                          }
                          placement="top"
                        >
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {permission.type === 'anyone'
                              ? 'Anyone with link'
                              : permission.type === 'domain'
                                ? (permission.domain || permission.displayName || 'Domain')
                                : permission.displayName
                                  || (permission.emailAddress
                                    ? directoryNameByEmail[permission.emailAddress.toLowerCase()]
                                    : undefined)
                                  || '—'}
                          </Typography>
                        </Tooltip>
                      </Box>
                      <Box sx={permCols.cellSx('email')}>
                        <Tooltip title={permission.type === 'anyone' ? '' : (permission.emailAddress || permission.domain || '')} placement="top">
                          <Typography sx={{ fontFamily: T.mono, fontSize: '0.75rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {permission.type === 'anyone'
                              ? 'Anyone with link'
                              : permission.emailAddress || permission.domain || permission.id || '—'}
                          </Typography>
                        </Tooltip>
                      </Box>
                      <Box sx={permCols.cellSx('access')}>
                        {isPermissionExternal(permission, allowedDomains) ? (
                          <ExternalChip />
                        ) : (
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textTertiary(t) }}>
                            Internal
                          </Typography>
                        )}
                      </Box>
                      <Box sx={permCols.cellSx('role')} onClick={(e) => e.stopPropagation()}>
                        {isOwner ? (
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>
                            Owner
                          </Typography>
                        ) : (
                          <Select
                            size="small"
                            value={permission.role}
                            onChange={(e) => {
                              const role = e.target.value;
                              if (role !== permission.role) void handleUpdatePermission(permission.id, role);
                            }}
                            MenuProps={selectMenuProps}
                            sx={{
                              width: '100%',
                              maxWidth: 128,
                              height: 30,
                              fontSize: '0.8125rem',
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
                      minWidth: 0,
                      width: '100%',
                      boxSizing: 'border-box',
                      borderTop: `1px solid ${pick(t, T.borderSubtle, '#27272a')}`,
                      bgcolor: pick(t, T.surfaceHover, '#27272a'),
                    })}
                  >
                    <Box sx={listCheckboxSx} />
                    <Box sx={{ flex: '0 0 100px', width: 100, minWidth: 100, overflow: 'hidden' }}>
                      <FormControl size="small" fullWidth>
                        <Select
                          value={newPermissionType}
                          onChange={(e) => setNewPermissionType(e.target.value as 'user' | 'domain' | 'anyone')}
                          displayEmpty
                          MenuProps={selectMenuProps}
                          sx={{
                            width: '100%',
                            height: 30,
                            fontSize: '0.8125rem',
                            fontFamily: T.font,
                            '& .MuiSelect-select': { py: 0.5, minHeight: 'auto', pr: '28px !important' },
                            '& .MuiSelect-icon': { right: 4 },
                          }}
                        >
                          <MenuItem value="user">User</MenuItem>
                          <MenuItem value="domain">Domain</MenuItem>
                          <MenuItem value="anyone">Anyone</MenuItem>
                        </Select>
                      </FormControl>
                    </Box>
                    {/* Spans name + email + access so the identity field can breathe */}
                    <Box sx={{ flex: '1 1 0px', minWidth: 0, overflow: 'hidden' }}>
                      {newPermissionType === 'anyone' ? (
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>
                          Anyone with the link
                        </Typography>
                      ) : newPermissionType === 'domain' ? (
                        <TextField
                          autoFocus
                          size="small"
                          placeholder="domain.com"
                          value={newPermissionDomain}
                          onChange={(e) => setNewPermissionDomain(e.target.value)}
                          fullWidth
                          sx={{ fontFamily: T.font, '& .MuiOutlinedInput-root': { fontSize: '0.8125rem', height: 30 }, '& .MuiInputBase-input': { py: 0.5 } }}
                        />
                      ) : (
                        <Autocomplete
                          freeSolo
                          options={directorySuggestions}
                          value={newPermissionEmail}
                          inputValue={newPermissionEmail}
                          onInputChange={(_, value) => setNewPermissionEmail(value)}
                          onChange={(_, value) => setNewPermissionEmail(typeof value === 'string' ? value : '')}
                          loading={loadingDirectoryUsers}
                          filterOptions={(options, { inputValue }) => {
                            if (!inputValue.trim()) return options;
                            const search = inputValue.toLowerCase().trim();
                            return options.filter((option) => option.toLowerCase().includes(search));
                          }}
                          fullWidth
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              autoFocus
                              size="small"
                              placeholder="Type name or email"
                              sx={{
                                fontFamily: T.font,
                                '& .MuiOutlinedInput-root': { fontSize: '0.8125rem', height: 30 },
                                '& .MuiInputBase-input': { py: 0.5 },
                              }}
                            />
                          )}
                        />
                      )}
                    </Box>
                    <Box sx={{ flex: '0 0 128px', width: 128, minWidth: 120, overflow: 'hidden' }}>
                      <FormControl size="small" fullWidth>
                        <Select
                          value={newPermissionRole}
                          onChange={(e) => setNewPermissionRole(e.target.value as 'reader' | 'commenter' | 'writer')}
                          MenuProps={selectMenuProps}
                          sx={{
                            width: '100%',
                            height: 30,
                            fontSize: '0.8125rem',
                            fontFamily: T.font,
                            '& .MuiSelect-select': { py: 0.5, minHeight: 'auto' },
                          }}
                        >
                          <MenuItem value="reader">Viewer</MenuItem>
                          <MenuItem value="commenter">Commenter</MenuItem>
                          <MenuItem value="writer">Editor</MenuItem>
                        </Select>
                      </FormControl>
                    </Box>
                    <Box sx={{ ...listActionsSx, width: 64, minWidth: 64, flex: '0 0 64px', gap: 0.25 }}>
                      <ActionTooltip title="Cancel">
                        <IconButton size="small" onClick={() => { setAddPermissionDialogOpen(false); setNewPermissionEmail(''); setNewPermissionDomain(''); }} aria-label="Cancel">
                          <X size={18} strokeWidth={1.75} />
                        </IconButton>
                      </ActionTooltip>
                      <ActionTooltip title="Add">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={handleAddFilePermission}
                          disabled={!((newPermissionType === 'user' && normalizeEmailInput(newPermissionEmail)) || (newPermissionType === 'domain' && newPermissionDomain.trim()) || newPermissionType === 'anyone')}
                          aria-label="Add"
                        >
                          <Check size={18} strokeWidth={1.75} />
                        </IconButton>
                      </ActionTooltip>
                    </Box>
                  </Box>
                ) : (
                  <Box sx={(t) => ({ px: 2, py: 1, borderTop: (selectedFile.permissions ?? []).length > 0 ? `1px solid ${pick(t, T.borderSubtle, '#27272a')}` : 'none' })}>
                    <Button
                      size="small"
                      variant="text"
                      color="primary"
                      onClick={() => setAddPermissionDialogOpen(true)}
                      startIcon={<Plus size={15} strokeWidth={1.75} />}
                      sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 600 }}
                    >
                      Add user or group
                    </Button>
                  </Box>
                )}
              </ListShell>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, borderTop: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}`, gap: 1 }}>
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
