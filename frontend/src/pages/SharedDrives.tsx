import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Autocomplete,
  FormControl,
  Select,
  MenuItem,
  IconButton,
  Button,
  Alert,
  Snackbar,
  TablePagination,
  Checkbox,
  Popover,
  Grid,
  Divider,
  InputAdornment,
  useMediaQuery,
} from '@mui/material';
import {
  Trash2,
  Plus,
  Search,
  RefreshCw,
  ListFilter,
  Calendar,
  ExternalLink,
  X,
  Check,
  Users,
} from 'lucide-react';
import { apiClient } from '../services/api.client';
import { useTable, TableColumn } from '../hooks/useTable.tsx';
import { ExportButton } from '../components/ExportButton';
import { DateRangeCalendar } from '../components/DateRangeCalendar';
import { ActionTooltip } from '../components/ActionTooltip';
import { T, pick, selectMenuProps, textSecondary, textTertiary, exportToolbarButtonSx } from '../theme/designTokens';
import { tablePaginationProps } from '../components/ui/tablePaginationProps';
import { ColumnHeader } from '../components/ui/ColumnHeader';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { ListShell, ListHeaderRow, ListDataRow, listActionsSx, listPrimaryColSx } from '../components/ui/ListShell';
import { DialogListPagination, DIALOG_LIST_PAGE_SIZE } from '../components/ui/DialogListPagination';
import { DIALOG_LIST_SORT, dialogListNoopSort } from '../components/ui/dialogListSort';
import { DotLabel, ExternalChip } from '../components/StatusDot';
import { FilterToken } from '../components/ui/FilterToken';
import { useTheme } from '@mui/material/styles';
import { getApiErrorMessage } from '../utils/apiError';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmailInput(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (EMAIL_RE.test(trimmed)) return trimmed;
  const inParens = trimmed.match(/\(([^\s@]+@[^\s@]+\.[^\s@]+)\)\s*$/)?.[1];
  return inParens || '';
}

interface SharedDrive {
  id: string;
  name: string;
  kind: string;
  createdTime?: string;
  hidden?: boolean;
  // The Drive API `drives` resource exposes sharing restrictions + capabilities
  // (not storage/OU/creator — those aren't available for shared drives).
  restrictions?: {
    adminManagedRestrictions?: boolean;
    copyRequiresWriterPermission?: boolean;
    domainUsersOnly?: boolean;
    driveMembersOnly?: boolean;
    sharingFoldersRequiresOrganizerPermission?: boolean;
  };
}

// A shared drive allows external members unless it's locked to the domain.
function allowsExternalMembers(drive: SharedDrive): boolean {
  return drive.restrictions?.domainUsersOnly !== true;
}

const EXTERNAL_DOMAIN_RE = /@([^\s@]+)$/;

interface SharedDrivePermission {
  id: string;
  type: 'user' | 'group' | 'domain' | 'anyone';
  role: 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader';
  emailAddress?: string;
  domain?: string;
  displayName?: string;
  deleted?: boolean;
}

export function SharedDrives() {
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
  const [drives, setDrives] = useState<SharedDrive[]>([]);
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  // 0 = All drives, 1 = Externally shared, 2 = No members.
  const [tabValue, setTabValue] = useState(0);
  // Member counts are not in the list response; fetched lazily for the "No
  // members" tab. -1 means the per-drive lookup failed (treated as unknown).
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [countsLoading, setCountsLoading] = useState(false);
  const [countsFetched, setCountsFetched] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDrive, setSelectedDrive] = useState<SharedDrive | null>(null);
  const [permissions, setPermissions] = useState<SharedDrivePermission[]>([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [permissionsDialogOpen, setPermissionsDialogOpen] = useState(false);
  const [addPermissionDialogOpen, setAddPermissionDialogOpen] = useState(false);
  const [sdPermissionsPage, setSdPermissionsPage] = useState(0);
  const [sdPermissionsRowsPerPage, setSdPermissionsRowsPerPage] = useState(DIALOG_LIST_PAGE_SIZE);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // Add permission form state
  const [newPermissionType, setNewPermissionType] = useState<'user' | 'group' | 'domain'>('user');
  const [newPermissionRole, setNewPermissionRole] = useState<'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader'>('reader');
  const [newPermissionEmail, setNewPermissionEmail] = useState('');
  const [newPermissionDomain, setNewPermissionDomain] = useState('');
  const [directorySuggestions, setDirectorySuggestions] = useState<string[]>([]);
  const [loadingDirectoryUsers, setLoadingDirectoryUsers] = useState(false);
  const [selectedDriveIds, setSelectedDriveIds] = useState<Set<string>>(new Set());
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<Set<string>>(new Set());

  interface SharedDriveFiltersType {
    name: string;
    status: string;
    sharing: string;
    dateCreatedFrom: string;
    dateCreatedTo: string;
    sharedDriveId: string;
  }
  const [filters, setFilters] = useState<SharedDriveFiltersType>({
    name: '',
    status: '',
    sharing: '',
    dateCreatedFrom: '',
    dateCreatedTo: '',
    sharedDriveId: '',
  });
  const [filtersVisible, setFiltersVisible] = useState(false);
  const exportAllCSVRef = useRef<() => void>(() => {});
  const exportSelectedCSVRef = useRef<() => void>(() => {});
  const [dateCreatedAnchor, setDateCreatedAnchor] = useState<HTMLElement | null>(null);

  const formatFilterDateRange = (from: string, to: string): string => {
    if (!from && !to) return 'Any';
    const fmt = (s: string) => { const d = new Date(`${s}T12:00:00`); return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
    if (!to || from === to) return fmt(from);
    return `${fmt(from)} \u2013 ${fmt(to)}`;
  };

  const handleFilterChange = (key: keyof SharedDriveFiltersType, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };
  const hasActiveFilters = () => Object.values(filters).some((v) => v.trim() !== '');
  const clearFilters = () => {
    setFilters({
      name: '',
      status: '',
      sharing: '',
      dateCreatedFrom: '',
      dateCreatedTo: '',
      sharedDriveId: '',
    });
  };

  const activeFilterLabels = useMemo(() => {
    const tokens: Array<{ label: string; key: keyof SharedDriveFiltersType }> = [];
    if (filters.name) tokens.push({ label: `Name: ${filters.name}`, key: 'name' });
    if (filters.status) tokens.push({ label: filters.status === 'active' ? 'Active' : 'Hidden', key: 'status' });
    if (filters.sharing) tokens.push({ label: filters.sharing === 'external' ? 'External allowed' : 'Domain only', key: 'sharing' });
    if (filters.dateCreatedFrom) {
      const fmt = (s: string) => { const d = new Date(`${s}T12:00:00`); return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
      tokens.push({ label: `Created ${fmt(filters.dateCreatedFrom)}${filters.dateCreatedTo && filters.dateCreatedTo !== filters.dateCreatedFrom ? ` \u2013 ${fmt(filters.dateCreatedTo)}` : ''}`, key: 'dateCreatedFrom' });
    }
    if (filters.sharedDriveId) tokens.push({ label: `ID: ${filters.sharedDriveId}`, key: 'sharedDriveId' });
    return tokens;
  }, [filters]);

  // Tab filter (composes with search + column filters, doesn't replace them).
  const tabFilteredDrives = useMemo(() => {
    if (tabValue === 1) return drives.filter((d) => allowsExternalMembers(d));
    if (tabValue === 2) return drives.filter((d) => memberCounts[d.id] === 0);
    return drives;
  }, [drives, tabValue, memberCounts]);

  const filteredByColumnFilters = useMemo(() => {
    return tabFilteredDrives.filter((d) => {
      if (filters.name.trim() && !String(d.name ?? '').toLowerCase().includes(filters.name.toLowerCase())) return false;
      if (filters.status === 'active' && d.hidden) return false;
      if (filters.status === 'hidden' && !d.hidden) return false;
      if (filters.sharing === 'external' && !allowsExternalMembers(d)) return false;
      if (filters.sharing === 'domain' && allowsExternalMembers(d)) return false;
      if (filters.dateCreatedFrom.trim() || filters.dateCreatedTo.trim()) {
        if (!d.createdTime) return false;
        const startStr = filters.dateCreatedFrom || filters.dateCreatedTo;
        const endStr = filters.dateCreatedTo || filters.dateCreatedFrom;
        const from = new Date(startStr); from.setHours(0, 0, 0, 0);
        const to = new Date(endStr); to.setHours(23, 59, 59, 999);
        const t = new Date(d.createdTime);
        if (t < from || t > to) return false;
      }
      if (filters.sharedDriveId.trim() && !String(d.id ?? '').toLowerCase().includes(filters.sharedDriveId.toLowerCase())) return false;
      return true;
    });
  }, [tabFilteredDrives, filters]);

  // Creator/OU/storage aren't exposed by the Drive API for shared drives.
  // Member counts come from a separate endpoint (lazy-loaded).
  const columns: TableColumn<SharedDrive>[] = [
    { id: 'name', label: 'Name', sortable: true, getValue: (row) => row.name },
    { id: 'hidden', label: 'Visibility', sortable: true, getValue: (row) => row.hidden ? 'Hidden' : 'Active' },
    { id: 'createdTime', label: 'Created', sortable: true, getValue: (row) => row.createdTime ? new Date(row.createdTime).getTime() : 0 },
    { id: 'sharing', label: 'Sharing', sortable: true, getValue: (row) => allowsExternalMembers(row) ? 'External' : 'Internal' },
    {
      id: 'members',
      label: 'Members',
      sortable: true,
      getValue: (row) => (typeof memberCounts[row.id] === 'number' ? memberCounts[row.id] : -1),
    },
  ];

  const getSharedDriveUrl = (driveId: string) => `https://drive.google.com/drive/folders/${driveId}`;

  // Use table hook
  const {
    data: tableData,
    page,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    searchTerm,
    setSearchTerm,
    sortConfig,
    handleSort,
    exportToCSV,
    totalRows,
  } = useTable(filteredByColumnFilters, columns, 'name');

  useEffect(() => {
    fetchSharedDrives();
    // Authoritative internal-domain list for external-collaborator classification.
    apiClient
      .get('/auth/me')
      .then((r) => setAllowedDomains(Array.isArray(r.data?.allowedDomains) ? r.data.allowedDomains : []))
      .catch(() => setAllowedDomains([]));
  }, []);

  // Load member counts once for the table (and empty-drives tab).
  useEffect(() => {
    if (countsFetched || countsLoading) return;
    const fetchCounts = async () => {
      setCountsLoading(true);
      try {
        const res = await apiClient.get('/drive/shared-drives/member-counts');
        setMemberCounts(res.data?.counts && typeof res.data.counts === 'object' ? res.data.counts : {});
        setCountsFetched(true);
      } catch (error) {
        console.error('Error fetching shared drive member counts:', error);
        // Non-fatal for main list; empty tab will show without counts.
      } finally {
        setCountsLoading(false);
      }
    };
    void fetchCounts();
  }, [countsFetched, countsLoading]);

  // Reset paging + selection when switching tabs.
  useEffect(() => {
    setPage(0);
    setSelectedDriveIds(new Set());
  }, [tabValue, setPage]);

  // A shared-drive permission is external when the principal's domain isn't in
  // the org's allowed list (or it's an "anyone" link). Unknown domains don't flag.
  const isPermissionExternal = (permission: SharedDrivePermission): boolean => {
    if (permission.type === 'anyone') return true;
    const domains = allowedDomains.map((d) => d.toLowerCase()).filter(Boolean);
    if (domains.length === 0) return false;
    if (permission.type === 'domain' && permission.domain) return !domains.includes(permission.domain.toLowerCase());
    const email = permission.emailAddress || '';
    const match = email.match(EXTERNAL_DOMAIN_RE);
    const domain = match?.[1]?.toLowerCase();
    return !!domain && !domains.includes(domain);
  };


  const isDriveSelected = (drive: SharedDrive) => selectedDriveIds.has(drive.id);
  const handleSelectDrive = (drive: SharedDrive) => {
    setSelectedDriveIds((prev) => {
      const next = new Set(prev);
      if (next.has(drive.id)) next.delete(drive.id);
      else next.add(drive.id);
      return next;
    });
  };
  const handleSelectAllDrives = () => {
    if (selectedDriveIds.size === tableData.length) {
      setSelectedDriveIds(new Set());
    } else {
      setSelectedDriveIds(new Set(tableData.map((d) => d.id)));
    }
  };

  const handleExportAllCSV = () => { exportToCSV(`SharedDrives${searchTerm || hasActiveFilters() ? '_filtered' : ''}_${new Date().toISOString().split('T')[0]}.csv`); setSnackbar({ open: true, message: 'CSV downloading now.', severity: 'success' }); };
  const handleExportSelectedCSV = () => {
    const selected = tableData.filter((d) => selectedDriveIds.has(d.id));
    if (selected.length === 0) return;
    const csvData = selected.map((d) => ({
      Name: d.name,
      ID: d.id,
      Created: d.createdTime ? new Date(d.createdTime).toISOString() : '',
      Status: d.hidden ? 'Hidden' : 'Active',
    }));
    const headers = Object.keys(csvData[0] || {});
    const rows = csvData.map((row) =>
      headers
        .map((h) => {
          const v = row[h as keyof typeof row];
          const s = v === null || v === undefined ? '' : String(v);
          return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `shared-drives-selected-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
    setSnackbar({ open: true, message: 'Selected drives exported.', severity: 'success' });
  };
  const handleExportFilteredCSV = () => { exportToCSV(`SharedDrives_filtered_${new Date().toISOString().split('T')[0]}.csv`); setSnackbar({ open: true, message: 'Filtered export downloading.', severity: 'success' }); };
  const handleExportAllDrive = async () => {
    try {
      const response = await apiClient.post('/drive/shared-drives/export/drive');
      if (response.data?.webViewLink) window.open(response.data.webViewLink, '_blank');
      setSnackbar({ open: true, message: 'Saved to Google Drive.', severity: 'success' });
    } catch (err: any) {
      console.error(err);
      setSnackbar({ open: true, message: getApiErrorMessage(err, 'Drive export failed.'), severity: 'error' });
    }
  };
  const handleExportSelectedDrive = async () => {
    if (selectedDriveIds.size === 0) return;
    try {
      const response = await apiClient.post('/drive/shared-drives/export/selected/drive', {
        driveIds: Array.from(selectedDriveIds),
      });
      if (response.data?.webViewLink) window.open(response.data.webViewLink, '_blank');
      setSnackbar({ open: true, message: 'Selection saved to Google Drive.', severity: 'success' });
    } catch (err: any) {
      console.error(err);
      setSnackbar({ open: true, message: getApiErrorMessage(err, 'Drive export failed.'), severity: 'error' });
    }
  };
  const handleExportFilteredDrive = async () => {
    try {
      const response = await apiClient.post('/drive/shared-drives/export/drive');
      if (response.data?.webViewLink) window.open(response.data.webViewLink, '_blank');
      setSnackbar({ open: true, message: 'Filtered export saved to Google Drive.', severity: 'success' });
    } catch (err: any) {
      console.error(err);
      setSnackbar({ open: true, message: getApiErrorMessage(err, 'Drive export failed.'), severity: 'error' });
    }
  };

  exportAllCSVRef.current = handleExportAllCSV;
  exportSelectedCSVRef.current = handleExportSelectedCSV;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setFiltersVisible((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        e.stopPropagation();
        const fn = selectedDriveIds.size > 0 ? exportSelectedCSVRef.current : exportAllCSVRef.current;
        if (typeof fn === 'function') fn();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
        e.preventDefault();
        if (selectedDriveIds.size > 0) handleExportSelectedDrive();
        else if (Boolean(searchTerm) || hasActiveFilters()) handleExportFilteredDrive();
        else handleExportAllDrive();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [selectedDriveIds.size]);

  useEffect(() => {
    if (!permissionsDialogOpen) return;
    setSdPermissionsPage(0);
  }, [permissionsDialogOpen, selectedDrive?.id]);

  useEffect(() => {
    const max = Math.max(0, Math.ceil(permissions.length / sdPermissionsRowsPerPage) - 1);
    setSdPermissionsPage((p) => Math.min(p, max));
  }, [permissions.length, sdPermissionsRowsPerPage]);

  useEffect(() => {
    if (!addPermissionDialogOpen || newPermissionType === 'domain' || loadingDirectoryUsers || directorySuggestions.length > 0) return;
    const fetchDirectoryUsers = async () => {
      try {
        setLoadingDirectoryUsers(true);
        const response = await apiClient.get('/users?maxResults=500');
        const uniqueByEmail = new Map<string, string>();
        if (Array.isArray(response.data)) {
          for (const user of response.data) {
            const email = String(user?.primaryEmail || '').trim();
            if (!EMAIL_RE.test(email)) continue;
            const fullName = String(user?.name?.fullName || '').trim();
            uniqueByEmail.set(email, fullName ? `${fullName} (${email})` : email);
          }
        }
        setDirectorySuggestions(Array.from(uniqueByEmail.values()).sort((a, b) => a.localeCompare(b)));
      } catch (error) {
        console.error('Error fetching users for shared drive permission suggestions:', error);
        setDirectorySuggestions([]);
      } finally {
        setLoadingDirectoryUsers(false);
      }
    };
    void fetchDirectoryUsers();
  }, [addPermissionDialogOpen, newPermissionType, loadingDirectoryUsers, directorySuggestions.length]);

  const fetchSharedDrives = async () => {
    try {
      setLoading(true);
      // Cached member counts are keyed to the current drive set; invalidate them
      // so the "No members" tab re-resolves after a refresh.
      setMemberCounts({});
      setCountsFetched(false);
      const response = await apiClient.get('/drive/shared-drives');
      const payload = response.data;
      if (Array.isArray(payload)) {
        setDrives(payload);
      } else if (payload && Array.isArray(payload.drives)) {
        setDrives(payload.drives);
      } else {
        setDrives([]);
      }
      setLoadError(null);
    } catch (error: any) {
      console.error('Error fetching shared drives:', error);
      setDrives([]);
      setLoadError(getApiErrorMessage(error, 'Failed to load shared drives'));
    } finally {
      setLoading(false);
    }
  };

  const fetchPermissions = async (driveId: string) => {
    try {
      setPermissionsLoading(true);
      const response = await apiClient.get(`/drive/shared-drives/${driveId}/permissions`);
      const payload = response.data;
      if (Array.isArray(payload)) {
        setPermissions(payload);
      } else if (payload && Array.isArray(payload.permissions)) {
        setPermissions(payload.permissions);
      } else {
        setPermissions([]);
      }
    } catch (error: any) {
      console.error('Error fetching permissions:', error);
      setPermissions([]);
      setSnackbar({
        open: true,
        message: getApiErrorMessage(error, 'Failed to load shared drive permissions.'),
        severity: 'error',
      });
    } finally {
      setPermissionsLoading(false);
    }
  };

  const handleViewPermissions = async (drive: SharedDrive) => {
    setSelectedDrive(drive);
    setPermissionsDialogOpen(true);
    await fetchPermissions(drive.id);
  };

  const handleClosePermissionsDialog = () => {
    setPermissionsDialogOpen(false);
    setSelectedDrive(null);
    setPermissions([]);
    setSelectedPermissionIds(new Set());
  };

  const handleAddPermission = async () => {
    if (!selectedDrive) return;
    const normalizedPermissionEmail = normalizeEmailInput(newPermissionEmail);

    if ((newPermissionType === 'user' || newPermissionType === 'group') && !normalizedPermissionEmail) {
      setSnackbar({ open: true, message: 'Email address is required', severity: 'error' });
      return;
    }

    if (newPermissionType === 'domain' && !newPermissionDomain.trim()) {
      setSnackbar({ open: true, message: 'Domain is required', severity: 'error' });
      return;
    }

    try {
      await apiClient.post(`/drive/shared-drives/${selectedDrive.id}/permissions`, {
        type: newPermissionType,
        role: newPermissionRole,
        emailAddress: newPermissionType === 'user' || newPermissionType === 'group' ? normalizedPermissionEmail : undefined,
        domain: newPermissionType === 'domain' ? newPermissionDomain.trim() : undefined,
      });

      setSnackbar({ open: true, message: 'Permission added successfully', severity: 'success' });
      setAddPermissionDialogOpen(false);
      setNewPermissionEmail('');
      setNewPermissionDomain('');
      await fetchPermissions(selectedDrive.id);
    } catch (error: any) {
      console.error('Error adding permission:', error);
      setSnackbar({
        open: true,
        message: getApiErrorMessage(error, 'Failed to add permission'),
        severity: 'error',
      });
    }
  };

  const handleRemovePermission = async (permissionId: string) => {
    if (!selectedDrive) return;
    if (!confirm('Are you sure you want to remove this permission?')) return;

    try {
      await apiClient.delete(`/drive/shared-drives/${selectedDrive.id}/permissions/${permissionId}`);
      setPermissions((prev) => prev.filter((p) => p.id !== permissionId));
      setSelectedPermissionIds((prev) => {
        const next = new Set(prev);
        next.delete(permissionId);
        return next;
      });
      setSnackbar({ open: true, message: 'Permission removed successfully', severity: 'success' });
    } catch (error: any) {
      console.error('Error removing permission:', error);
      setSnackbar({
        open: true,
        message: getApiErrorMessage(error, 'Failed to remove permission'),
        severity: 'error',
      });
    }
  };

  const handleBulkRemovePermissions = async () => {
    if (!selectedDrive || selectedPermissionIds.size === 0) return;
    const count = selectedPermissionIds.size;
    if (!confirm(`Remove ${count} permission(s)?`)) return;
    try {
      for (const id of selectedPermissionIds) {
        await apiClient.delete(`/drive/shared-drives/${selectedDrive.id}/permissions/${id}`);
      }
      setPermissions((prev) => prev.filter((p) => !selectedPermissionIds.has(p.id)));
      setSelectedPermissionIds(new Set());
      setSnackbar({ open: true, message: `${count} permission(s) removed`, severity: 'success' });
    } catch (error: any) {
      console.error('Error bulk removing permissions:', error);
      setSnackbar({
        open: true,
        message: getApiErrorMessage(error, 'Failed to remove some permissions'),
        severity: 'error',
      });
    }
  };

  const togglePermissionSelected = (permissionId: string) => {
    setSelectedPermissionIds((prev) => {
      const next = new Set(prev);
      if (next.has(permissionId)) next.delete(permissionId);
      else next.add(permissionId);
      return next;
    });
  };

  const selectAllPermissions = (checked: boolean) => {
    setSelectedPermissionIds(checked ? new Set(permissions.map((p) => p.id)) : new Set());
  };

  const getRoleDotColor = (role: string) => {
    switch (role) {
      case 'organizer':
        return T.danger;
      case 'fileOrganizer':
        return T.warning;
      case 'writer':
        return T.accent;
      case 'commenter':
        return '#0ea5e9';
      case 'reader':
        return textTertiary(muiTheme);
      default:
        return textTertiary(muiTheme);
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'user':
        return 'User';
      case 'group':
        return 'Group';
      case 'domain':
        return 'Domain';
      case 'anyone':
        return 'Anyone';
      default:
        return type;
    }
  };

  // Organizers (the shared-drive equivalent of an owner) pinned to the top;
  // otherwise original order preserved (stable via index tiebreaker).
  const sortedPermissions = useMemo(() => {
    return permissions
      .map((p, i) => ({ p, i }))
      .sort((a, b) => (a.p.role === 'organizer' ? 0 : 1) - (b.p.role === 'organizer' ? 0 : 1) || a.i - b.i)
      .map((x) => x.p);
  }, [permissions]);
  const sdPermMaxPage = Math.max(0, Math.ceil(sortedPermissions.length / sdPermissionsRowsPerPage) - 1);
  const sdPermPageSafe = Math.min(sdPermissionsPage, sdPermMaxPage);
  const pagedSharedDrivePermissions = useMemo(() => {
    const start = sdPermPageSafe * sdPermissionsRowsPerPage;
    return sortedPermissions.slice(start, start + sdPermissionsRowsPerPage);
  }, [sortedPermissions, sdPermPageSafe, sdPermissionsRowsPerPage]);

  return (
    <Box sx={{ fontFamily: T.font, minHeight: '100vh' }}>
      {/* Header — always visible */}
      <Box sx={{ mb: 3, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, alignItems: { md: 'center' }, justifyContent: 'space-between' }}>
        <Typography sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.02em', color: (theme: any) => pick(theme, T.text, '#fafafa') }}>
          Shared drives
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <SegmentedControl value={tabValue} options={['All drives', 'Externally shared', 'No members']} onChange={setTabValue} />
        </Box>
      </Box>

      {/* Toolbar — always visible */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Search shared drives..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Box component="span" sx={{ display: 'flex', color: (t: any) => textTertiary(t) }}>
                  <Search size={18} strokeWidth={1.75} />
                </Box>
              </InputAdornment>
            ),
            ...(searchTerm ? { endAdornment: (
              <InputAdornment position="end">
                <Box component="span" onClick={() => setSearchTerm('')} sx={{ display: 'flex', cursor: 'pointer', color: (t: any) => textTertiary(t) }}>
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
            <ListFilter size={18} strokeWidth={1.75} />
          </IconButton>
        </ActionTooltip>

        <ActionTooltip title="Refresh data">
          <IconButton size="small" onClick={fetchSharedDrives} aria-label="Refresh data" sx={{ color: (t: any) => textSecondary(t) }}>
            <RefreshCw size={18} strokeWidth={1.75} />
          </IconButton>
        </ActionTooltip>

        <Box sx={{ flex: 1 }} />

        {selectedDriveIds.size > 0 && (
          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, color: T.accent }}>
            {selectedDriveIds.size} selected
          </Typography>
        )}

        <ExportButton
          iconOnly={!isMdUp}
          tooltipTitle="Export"
          totalItems={tableData.length}
          selectedCount={selectedDriveIds.size}
          hasFilters={Boolean(searchTerm) || hasActiveFilters()}
          onExportAllCSV={handleExportAllCSV}
          onExportSelectedCSV={handleExportSelectedCSV}
          onExportFilteredCSV={handleExportFilteredCSV}
          onExportAllDrive={handleExportAllDrive}
          onExportSelectedDrive={handleExportSelectedDrive}
          onExportFilteredDrive={handleExportFilteredDrive}
          disabled={tableData.length === 0}
          triggerSx={exportToolbarButtonSx()}
        />
      </Box>

      {/* Filter panel (collapsible) */}
      <Box sx={{ overflow: 'hidden', maxHeight: filtersVisible ? 400 : 0, transition: 'max-height 0.25s ease, opacity 0.2s ease', opacity: filtersVisible ? 1 : 0, mb: filtersVisible ? 2 : 0 }}>
        <Box sx={(theme: any) => ({
          display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center',
          p: 1.5, borderRadius: T.radius, border: `1px solid ${pick(theme, T.border, '#3f3f46')}`, bgcolor: pick(theme, T.surface, '#27272a'),
        })}>
          <TextField size="small" placeholder="Name..." value={filters.name} onChange={(e) => handleFilterChange('name', e.target.value)} sx={{ fontFamily: T.font, fontSize: '0.8125rem', minWidth: 120, '& .MuiOutlinedInput-root': { fontSize: '0.8125rem', borderRadius: T.radiusSm } }} />
          <FormControl size="small" sx={{ minWidth: 110 }}>
            <Select
              value={filters.status} displayEmpty
              renderValue={(v) => (v ? (v === 'active' ? 'Active' : 'Hidden') : 'Status')}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              MenuProps={selectMenuProps}
              sx={{ fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm }}
            >
              <MenuItem value="">Any</MenuItem>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="hidden">Hidden</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <Select
              value={filters.sharing} displayEmpty
              renderValue={(v) => (v ? (v === 'external' ? 'External allowed' : 'Domain only') : 'External sharing')}
              onChange={(e) => handleFilterChange('sharing', e.target.value)}
              MenuProps={selectMenuProps}
              sx={{ fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm }}
            >
              <MenuItem value="">Any</MenuItem>
              <MenuItem value="external">External allowed</MenuItem>
              <MenuItem value="domain">Domain only</MenuItem>
            </Select>
          </FormControl>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography component="span" sx={{ fontFamily: T.font, fontSize: '0.75rem', fontWeight: 500, color: (t: any) => textTertiary(t), whiteSpace: 'nowrap' }}>
              Date created
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<Calendar size={18} strokeWidth={1.75} />}
              onClick={(e) => setDateCreatedAnchor(e.currentTarget)}
              sx={(theme: any) => ({
                fontFamily: T.font,
                fontSize: '0.75rem',
                textTransform: 'none',
                borderRadius: T.radiusSm,
                borderColor: pick(theme, T.border, '#5f6368'),
                color: textSecondary(theme),
                py: 0.5,
                '&:hover': {
                  borderColor: pick(theme, T.accent, '#8ab4f8'),
                  bgcolor: pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.08)'),
                },
              })}
            >
              {formatFilterDateRange(filters.dateCreatedFrom, filters.dateCreatedTo)}
            </Button>
          </Box>
          <Popover open={!!dateCreatedAnchor} anchorEl={dateCreatedAnchor} onClose={() => setDateCreatedAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
            <Box sx={{ p: 2 }}>
              <DateRangeCalendar mode="single-or-range" value={{ from: filters.dateCreatedFrom, to: filters.dateCreatedTo }} onChange={(v) => { const r = typeof v === 'string' ? { from: v, to: v } : v; handleFilterChange('dateCreatedFrom', r.from); handleFilterChange('dateCreatedTo', r.to); }} onClose={() => setDateCreatedAnchor(null)} />
            </Box>
          </Popover>
          <TextField size="small" placeholder="Drive ID..." value={filters.sharedDriveId} onChange={(e) => handleFilterChange('sharedDriveId', e.target.value)} sx={{ fontFamily: T.font, fontSize: '0.8125rem', minWidth: 120, '& .MuiOutlinedInput-root': { fontSize: '0.8125rem', borderRadius: T.radiusSm } }} />
          {hasActiveFilters() && (
            <Button size="small" onClick={clearFilters} sx={{ fontFamily: T.font, fontSize: '0.75rem', textTransform: 'none', color: (t: any) => textSecondary(t) }}>
              Clear all
            </Button>
          )}
        </Box>
      </Box>

      {/* Active filter tokens */}
      {activeFilterLabels.length > 0 && !filtersVisible && (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.5 }}>
          {activeFilterLabels.map((t) => (
            <FilterToken key={t.key} label={t.label} onRemove={() => {
              if (t.key === 'dateCreatedFrom') { handleFilterChange('dateCreatedFrom', ''); handleFilterChange('dateCreatedTo', ''); }
              else handleFilterChange(t.key, '');
            }} />
          ))}
        </Box>
      )}

      {loading || (tabValue === 2 && countsLoading) ? (
        <Box display="flex" flexDirection="column" gap={1.5} justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress size={28} thickness={4} sx={{ color: T.accent }} />
          {tabValue === 2 && countsLoading && !loading && (
            <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>
              Checking membership on each shared drive…
            </Typography>
          )}
        </Box>
      ) : (
        <>
          {loadError && !loading && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setLoadError(null)}>{loadError}</Alert>
          )}
          <ListShell>
            <ListHeaderRow>
              <Checkbox
                size="small"
                indeterminate={selectedDriveIds.size > 0 && selectedDriveIds.size < tableData.length}
                checked={tableData.length > 0 && selectedDriveIds.size === tableData.length}
                onChange={handleSelectAllDrives}
                sx={{ p: 0.25, mr: 0.5 }}
              />
              <ColumnHeader label="Name" columnId="name" sortConfig={sortConfig} onSort={handleSort} minWidth={160} />
              <ColumnHeader label="Visibility" columnId="hidden" sortConfig={sortConfig} onSort={handleSort} width={88} />
              <ColumnHeader label="Created" columnId="createdTime" sortConfig={sortConfig} onSort={handleSort} width={96} />
              <ColumnHeader label="Sharing" columnId="sharing" sortConfig={sortConfig} onSort={handleSort} width={96} />
              <ColumnHeader label="Members" columnId="members" sortConfig={sortConfig} onSort={handleSort} width={72} align="right" />
              <ColumnHeader label="Actions" columnId="__a" sortConfig={sortConfig} onSort={() => {}} sortable={false} width={80} align="right" />
            </ListHeaderRow>
            {tableData.length === 0 ? (
              <Box sx={{ py: 6, textAlign: 'center' }}>
                <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>
                  {tabValue === 1
                    ? 'No externally shared drives found'
                    : tabValue === 2
                      ? 'No shared drives without members'
                      : 'No shared drives found'}
                </Typography>
              </Box>
            ) : (
              tableData.map((drive, idx) => {
                const count = memberCounts[drive.id];
                const external = allowsExternalMembers(drive);
                return (
                  <ListDataRow
                    key={drive.id}
                    last={idx === tableData.length - 1}
                    selected={isDriveSelected(drive)}
                    onClick={() => handleViewPermissions(drive)}
                  >
                    <Checkbox size="small" checked={isDriveSelected(drive)} onChange={(e) => { e.stopPropagation(); handleSelectDrive(drive); }} sx={{ p: 0.25, flexShrink: 0 }} onClick={(e) => e.stopPropagation()} />
                    <Box sx={listPrimaryColSx}>
                      <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, color: (theme) => pick(theme, T.text, '#fafafa'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {drive.name}
                      </Typography>
                    </Box>
                    <Box sx={{ width: 88, flexShrink: 0 }}>
                      <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => (drive.hidden ? textTertiary(t) : textSecondary(t)) }}>
                        {drive.hidden ? 'Hidden' : 'Active'}
                      </Typography>
                    </Box>
                    <Box sx={{ width: 96, flexShrink: 0 }}>
                      <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>
                        {drive.createdTime ? new Date(drive.createdTime).toLocaleDateString() : '—'}
                      </Typography>
                    </Box>
                    <Box sx={{ width: 96, flexShrink: 0 }}>
                      <DotLabel dotColor={external ? T.warning : T.success}>
                        {external ? 'External' : 'Internal'}
                      </DotLabel>
                    </Box>
                    <Box sx={{ width: 72, flexShrink: 0, textAlign: 'right' }}>
                      <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>
                        {typeof count === 'number' ? count : countsLoading ? '…' : '—'}
                      </Typography>
                    </Box>
                    <Box
                      sx={listActionsSx}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ActionTooltip title="Open in Google Drive">
                        <IconButton
                          size="small"
                          onClick={() => window.open(getSharedDriveUrl(drive.id), '_blank', 'noopener,noreferrer')}
                          sx={{ p: 0.5, color: T.accent }}
                          aria-label="Open in Drive"
                        >
                          <ExternalLink size={16} strokeWidth={1.75} />
                        </IconButton>
                      </ActionTooltip>
                      <ActionTooltip title="Members & permissions">
                        <IconButton size="small" onClick={() => handleViewPermissions(drive)} sx={{ p: 0.5, color: T.accent }} aria-label="Members">
                          <Users size={16} strokeWidth={1.75} />
                        </IconButton>
                      </ActionTooltip>
                    </Box>
                  </ListDataRow>
                );
              })
            )}
          </ListShell>

          {totalRows > 0 && (
            <TablePagination
              component="div"
              count={totalRows}
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

      {/* Details & Permissions Dialog (mirrors Drive File Explorer permission dialog) */}
      <Dialog
        open={permissionsDialogOpen}
        onClose={handleClosePermissionsDialog}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: dialogPaperSx }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5, borderBottom: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}` }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.02em', color: (t) => pick(t, T.text, '#fafafa') }}>{selectedDrive?.name}</Typography>
            <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textSecondary(t), mt: 0.25 }}>Details & Permissions</Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: '20px !important' }}>
          {selectedDrive && (
            <Box sx={{ mb: 2 }}>
              <Typography sx={{ fontFamily: T.font, fontWeight: 600, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: (t) => textTertiary(t), mb: 1 }}>Drive details</Typography>
              <Grid container spacing={1.5} sx={{ mb: 2 }}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" display="block">Shared drive ID</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8125rem', wordBreak: 'break-all' }}>{selectedDrive.id}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" display="block">Created</Typography>
                  <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>{selectedDrive.createdTime ? new Date(selectedDrive.createdTime).toLocaleDateString() : '–'}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" display="block">Status</Typography>
                  <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>{selectedDrive.hidden ? 'Hidden' : 'Active'}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" display="block">External sharing</Typography>
                  <Box sx={{ mt: 0.25 }}>
                    <DotLabel dotColor={allowsExternalMembers(selectedDrive) ? T.warning : T.success}>
                      {allowsExternalMembers(selectedDrive) ? 'External members allowed' : 'Restricted to domain'}
                    </DotLabel>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" display="block">Access</Typography>
                  <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>{selectedDrive.restrictions?.driveMembersOnly ? 'Members only' : 'People with file access'}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" display="block">Copy / download / print</Typography>
                  <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>{selectedDrive.restrictions?.copyRequiresWriterPermission ? 'Editors only' : 'Viewers & commenters allowed'}</Typography>
                </Grid>
              </Grid>
              <Divider sx={{ my: 2 }} />
              <Typography sx={{ fontFamily: T.font, fontWeight: 600, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: (t) => textTertiary(t), mb: 1 }}>Permissions</Typography>
            </Box>
          )}
          {permissionsLoading ? (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
              <CircularProgress />
            </Box>
          ) : (
            <>
              {selectedPermissionIds.size > 0 && (
                <Box display="flex" gap={0.5} alignItems="center" mb={1.5}>
                  <ActionTooltip title={`Remove selected (${selectedPermissionIds.size})`}>
                    <IconButton size="small" color="error" onClick={handleBulkRemovePermissions} aria-label="Remove selected">
                      <Trash2 size={16} strokeWidth={1.75} />
                    </IconButton>
                  </ActionTooltip>
                </Box>
              )}

              <ListShell>
                <ListHeaderRow>
                  {permissions.length > 0 ? (
                    <Checkbox
                      size="small"
                      indeterminate={selectedPermissionIds.size > 0 && selectedPermissionIds.size < permissions.length}
                      checked={selectedPermissionIds.size === permissions.length}
                      onChange={(_, checked) => selectAllPermissions(checked)}
                      sx={{ p: 0.25, mr: 0.5 }}
                    />
                  ) : (
                    <Box sx={{ width: 34, mr: 0.5, flexShrink: 0 }} />
                  )}
                  <ColumnHeader label="Type" columnId="pt" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} width={56} />
                  <ColumnHeader label="Name" columnId="pn" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} minWidth={88} />
                  <ColumnHeader label="Email" columnId="pe" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} minWidth={120} />
                  <ColumnHeader label="Access" columnId="px" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} width={88} />
                  <ColumnHeader label="Role" columnId="pr" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} width={88} />
                  <ColumnHeader label="Actions" columnId="pa" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} width={80} align="right" />
                </ListHeaderRow>
                {permissions.length === 0 && !addPermissionDialogOpen && (
                  <Box sx={{ py: 4, textAlign: 'center' }}>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>No permissions found</Typography>
                  </Box>
                )}
                {pagedSharedDrivePermissions.map((permission, pidx) => {
                  const globalPidx = sdPermPageSafe * sdPermissionsRowsPerPage + pidx;
                  return (
                  <ListDataRow key={permission.id} last={globalPidx === permissions.length - 1 && addPermissionDialogOpen} selected={selectedPermissionIds.has(permission.id)}>
                    <Checkbox
                      size="small"
                      checked={selectedPermissionIds.has(permission.id)}
                      onChange={() => togglePermissionSelected(permission.id)}
                      sx={{ p: 0.25, mr: 0.5 }}
                    />
                    <Box sx={{ width: 56, flexShrink: 0 }}>
                      <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>
                        {getTypeLabel(permission.type)}
                      </Typography>
                    </Box>
                    <Box sx={listPrimaryColSx}>
                      <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {permission.type === 'anyone' ? 'Anyone with link' : permission.displayName || '—'}
                      </Typography>
                    </Box>
                    <Box sx={{ ...listPrimaryColSx, minWidth: 120, flex: '1.2 1 0' }}>
                      <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {permission.type === 'anyone'
                          ? 'Anyone with link'
                          : permission.emailAddress || permission.domain || permission.id || '—'}
                      </Typography>
                    </Box>
                    <Box sx={{ width: 88, flexShrink: 0 }}>
                      {isPermissionExternal(permission) ? (
                        <ExternalChip />
                      ) : (
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textTertiary(t) }}>Internal</Typography>
                      )}
                    </Box>
                    <Box sx={{ width: 88, flexShrink: 0 }}>
                      <DotLabel dotColor={getRoleDotColor(permission.role)}>{permission.role}</DotLabel>
                    </Box>
                    <Box sx={listActionsSx}>
                      <ActionTooltip title="Remove">
                        <IconButton size="small" color="error" onClick={() => handleRemovePermission(permission.id)} sx={{ p: 0.5 }}>
                          <Trash2 size={16} strokeWidth={1.75} />
                        </IconButton>
                      </ActionTooltip>
                    </Box>
                  </ListDataRow>
                  );
                })}
                <DialogListPagination
                  page={sdPermPageSafe}
                  rowsPerPage={sdPermissionsRowsPerPage}
                  total={permissions.length}
                  onPageChange={setSdPermissionsPage}
                  onRowsPerPageChange={(n) => {
                    setSdPermissionsRowsPerPage(n);
                    setSdPermissionsPage(0);
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
                    <Box sx={{ width: 34, flexShrink: 0 }} />
                    <Box sx={{ width: 88, flexShrink: 0 }}>
                      <FormControl size="small" fullWidth sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.8125rem', '& .MuiSelect-select': { py: 0.5 } } }}>
                        <Select value={newPermissionType} onChange={(e) => setNewPermissionType(e.target.value as 'user' | 'group' | 'domain')} displayEmpty>
                          <MenuItem value="user">User</MenuItem>
                          <MenuItem value="group">Group</MenuItem>
                          <MenuItem value="domain">Domain</MenuItem>
                        </Select>
                      </FormControl>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      {newPermissionType === 'domain' ? (
                        <TextField
                          autoFocus
                          size="small"
                          placeholder="domain.com"
                          value={newPermissionDomain}
                          onChange={(e) => setNewPermissionDomain(e.target.value)}
                          fullWidth
                          sx={{ fontFamily: T.font, '& .MuiOutlinedInput-root': { fontSize: '0.8125rem' }, '& .MuiInputBase-input': { py: 0.5 } }}
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
                              placeholder="Type name/email (e.g. ops)"
                              sx={{ fontFamily: T.font, '& .MuiOutlinedInput-root': { fontSize: '0.8125rem' }, '& .MuiInputBase-input': { py: 0.5 } }}
                            />
                          )}
                        />
                      )}
                    </Box>
                    <Box sx={{ width: 120, flexShrink: 0 }}>
                      <FormControl size="small" fullWidth sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.8125rem', '& .MuiSelect-select': { py: 0.5 } } }}>
                        <Select value={newPermissionRole} onChange={(e) => setNewPermissionRole(e.target.value as any)}>
                          <MenuItem value="reader">Reader</MenuItem>
                          <MenuItem value="commenter">Commenter</MenuItem>
                          <MenuItem value="writer">Writer</MenuItem>
                          <MenuItem value="fileOrganizer">File Organizer</MenuItem>
                          <MenuItem value="organizer">Organizer</MenuItem>
                        </Select>
                      </FormControl>
                    </Box>
                    <Box sx={{ width: 72, flexShrink: 0, display: 'flex', justifyContent: 'center', gap: 0.5 }}>
                      <ActionTooltip title="Cancel">
                        <IconButton size="small" onClick={() => { setAddPermissionDialogOpen(false); setNewPermissionEmail(''); setNewPermissionDomain(''); }} aria-label="Cancel">
                          <X size={18} strokeWidth={1.75} />
                        </IconButton>
                      </ActionTooltip>
                      <ActionTooltip title="Add">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={handleAddPermission}
                          disabled={!(((newPermissionType === 'user' || newPermissionType === 'group') && normalizeEmailInput(newPermissionEmail)) || (newPermissionType === 'domain' && newPermissionDomain.trim()))}
                          aria-label="Add"
                        >
                          <Check size={18} strokeWidth={1.75} />
                        </IconButton>
                      </ActionTooltip>
                    </Box>
                  </Box>
                ) : (
                  <Box sx={(t) => ({ px: 2, py: 1, borderTop: permissions.length > 0 ? `1px solid ${pick(t, T.borderSubtle, '#27272a')}` : 'none' })}>
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
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, borderTop: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}`, gap: 1 }}>
          <Button onClick={handleClosePermissionsDialog} sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, color: (t) => textSecondary(t), '&:hover': { bgcolor: (t) => pick(t, '#f0f0ec', '#27272a') } }}>
            Done
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnackbar((s) => ({ ...s, open: false }))} severity={snackbar.severity} sx={{ width: '100%', fontFamily: T.font, borderRadius: T.radius, alignItems: 'center' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
