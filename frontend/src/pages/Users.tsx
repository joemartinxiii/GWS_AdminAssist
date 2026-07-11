import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { generateExportFilename } from '../utils/filename';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  IconButton,
  Select,
  Popover,
  MenuItem,
  FormControl,
  Checkbox,
  Tooltip,
  Alert,
  Snackbar,
  Fade,
  useMediaQuery,
  TablePagination,
} from '@mui/material';
import type { AlertColor } from '@mui/material';
import {
  Mail,
  RefreshCw,
  Calendar,
  ListFilter,
  Trash2,
  Ban,
  ExternalLink,
} from 'lucide-react';
import type { AxiosError } from 'axios';
import { apiClient } from '../services/api.client';
import { usePermissions } from '../hooks/usePermissions';
import { ExportButton } from '../components/ExportButton';
import { DateRangeCalendar } from '../components/DateRangeCalendar';
import { ActionTooltip } from '../components/ActionTooltip';
import { useTheme } from '@mui/material/styles';
import { ConfirmDialog, type ConfirmEntity } from '../components/ConfirmDialog';
import { EditUserDialog } from '../components/EditUserDialog';
import { StatusDot, DotLabel } from '../components/StatusDot';
import { T, pick, selectMenuProps, textSecondary, textTertiary, exportToolbarButtonSx } from '../theme/designTokens';
import { tablePaginationProps } from '../components/ui/tablePaginationProps';
import { shortcut } from '../utils/keyboard';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { FilterToken } from '../components/ui/FilterToken';
import { ColumnHeader } from '../components/ui/ColumnHeader';
import { ListShell, ListHeaderRow, ListDataRow, listActionsSx, listCheckboxSx } from '../components/ui/ListShell';
import { ListChevron } from '../components/ui/ListChevron';
import { FlyoutSearch, type FlyoutSearchHandle } from '../components/ui/FlyoutSearch';
import { PageHeader } from '../components/ui/PageHeader';
import { ScoreRing } from '../components/ui/ScoreRing';
import { useResizableColumns } from '../hooks/useResizableColumns';
import { dialogDangerButtonSx, dialogSecondaryButtonSx } from '../theme/designTokens';
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface User {
  id: string;
  primaryEmail: string;
  name: { givenName: string; familyName: string; fullName: string };
  isAdmin: boolean;
  /** Delegated admin (not super admin); privileges from Directory API */
  isDelegatedAdmin?: boolean;
  delegatedAdminPrivileges?: string[];
  suspended: boolean;
  isEnforcedIn2Sv?: boolean;
  isEnrolledIn2Sv?: boolean;
  creationTime?: string;
  lastLoginTime?: string;
  orgUnitPath?: string;
  department?: string;
  location?: string;
  phone?: string;
  notes?: string;
}

interface UserFilters {
  search: string;
  status: string;
  role: string;
  twoFA: string;
  createdFrom: string;
  createdTo: string;
  lastLoginFrom: string;
  lastLoginTo: string;
}

type SortKey = 'name' | 'email' | 'status' | '2fa' | 'role' | 'adminType' | 'ou' | 'created' | 'lastLogin';
type SortDir = 'asc' | 'desc';

/** Leaf OU name for table (full path on tooltip). */
function orgUnitLeaf(path?: string): string {
  if (!path || path === '/') return '/';
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

/** Populated from /auth/me → protectedUsers (server GWS_PROTECTED_USERS). Empty by default. */
function isProtectedUser(email: string, protectedSet: Set<string>): boolean {
  return protectedSet.has(email.trim().toLowerCase());
}

function humanizeGooglePrivilege(id: string): string {
  return id
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Super admin vs delegated admin + assigned privileges (Google Workspace). */
function describeAdminType(u: User): string {
  if (u.isAdmin) return 'Super Admin';
  if (u.isDelegatedAdmin) {
    const privs = (u.delegatedAdminPrivileges || []).filter(Boolean);
    if (privs.length === 0) return 'Delegated admin';
    const head = privs.slice(0, 4).map(humanizeGooglePrivilege);
    const rest = privs.length > 4 ? ` +${privs.length - 4} more` : '';
    return `${head.join(', ')}${rest}`;
  }
  return '—';
}

function isWorkspaceAdmin(u: User): boolean {
  return u.isAdmin === true || u.isDelegatedAdmin === true;
}

/** Never delete admins or protected accounts from this app. */
function cannotDeleteUser(u: User, protectedSet: Set<string>): boolean {
  return isWorkspaceAdmin(u) || isProtectedUser(u.primaryEmail, protectedSet);
}

/** Directory API sometimes omits name parts; avoid runtime errors on People. */
function normalizeWorkspaceUser(raw: unknown): User {
  const u = raw as Record<string, unknown>;
  const nameObj = (u?.name as Record<string, unknown>) || {};
  const given = String(nameObj.givenName ?? '');
  const family = String(nameObj.familyName ?? '');
  const fullRaw = String(nameObj.fullName ?? '').trim();
  const full =
    fullRaw || [given, family].filter(Boolean).join(' ') || String(u?.primaryEmail ?? 'Unknown');
  return {
    id: String(u?.id ?? ''),
    primaryEmail: String(u?.primaryEmail ?? ''),
    name: { givenName: given, familyName: family, fullName: full },
    isAdmin: u?.isAdmin === true,
    isDelegatedAdmin: u?.isDelegatedAdmin === true,
    delegatedAdminPrivileges: Array.isArray(u?.delegatedAdminPrivileges)
      ? (u.delegatedAdminPrivileges as string[])
      : undefined,
    suspended: u?.suspended === true,
    isEnforcedIn2Sv: u?.isEnforcedIn2Sv === true,
    isEnrolledIn2Sv: u?.isEnrolledIn2Sv === true,
    creationTime: u?.creationTime as string | undefined,
    lastLoginTime: u?.lastLoginTime as string | undefined,
    orgUnitPath: u?.orgUnitPath as string | undefined,
    department: u?.department as string | undefined,
    location: u?.location as string | undefined,
    phone: u?.phone as string | undefined,
    notes: u?.notes as string | undefined,
  };
}

function apiErrorMessage(e: unknown, fallback: string): string {
  const err = e as AxiosError<{ error?: string }>;
  const status = err.response?.status;
  const data = err.response?.data;
  const msg = data?.error;
  if (status === 403) return msg || 'You don\'t have permission to view this data.';
  if (status === 401) return msg || 'Session expired. Sign in again.';
  return msg || err.message || fallback;
}

function formatFilterDateRange(from: string, to: string): string {
  if (!from && !to) return 'Any';
  const fmt = (s: string) => {
    if (!s) return '';
    const d = new Date(`${s}T12:00:00`);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };
  if (!to || from === to) return fmt(from);
  return `${fmt(from)} – ${fmt(to)}`;
}

// ---------------------------------------------------------------------------
// Tiny sub-components (co-located, not worth separate files)
// ---------------------------------------------------------------------------

function Initials({ name, suspended }: { name: string; suspended?: boolean }) {
  const letters = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  return (
    <Box
      sx={(theme) => ({
        width: 34,
        height: 34,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 600,
        fontSize: '0.75rem',
        letterSpacing: '0.02em',
        fontFamily: T.font,
        flexShrink: 0,
        bgcolor: suspended
          ? pick(theme, T.dangerSoft, '#3f1a1a')
          : pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.2)'),
        color: suspended
          ? pick(theme, T.danger, '#fca5a5')
          : pick(theme, T.accent, '#8ab4f8'),
        opacity: suspended ? 0.7 : 1,
      })}
    >
      {letters}
    </Box>
  );
}

// SegmentedControl + FilterToken extracted to shared components

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Users() {
  const [tab, setTab] = useState(0);
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [usersWithout2FAData, setUsersWithout2FAData] = useState<any>(null);
  const [usersWithout2FALoading, setUsersWithout2FALoading] = useState(false);
  const [filters, setFilters] = useState<UserFilters>({
    search: '', status: '', role: '', twoFA: '',
    createdFrom: '', createdTo: '', lastLoginFrom: '', lastLoginTo: '',
  });
  const searchFlyoutRef = useRef<FlyoutSearchHandle>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [selectedUsersWithout2FA, setSelectedUsersWithout2FA] = useState<Set<string>>(new Set());
  const [sending2FAEmails, setSending2FAEmails] = useState(false);
  const [organizationalUnits, setOrganizationalUnits] = useState<Array<{ orgUnitPath: string; name: string; displayName: string; level: number }>>([]);
  const [loadingOrgUnits, setLoadingOrgUnits] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [twoFAPage, setTwoFAPage] = useState(0);
  const [twoFARowsPerPage, setTwoFARowsPerPage] = useState(25);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [createdDateAnchor, setCreatedDateAnchor] = useState<HTMLElement | null>(null);
  const [lastLoginDateAnchor, setLastLoginDateAnchor] = useState<HTMLElement | null>(null);
  const [appeared, setAppeared] = useState(false);
  const { hasPermission, canTakeAction } = usePermissions();
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const isAdminsTab = tab === 1;
  const [protectedUserEmails, setProtectedUserEmails] = useState<Set<string>>(new Set());

  const cols = useResizableColumns(
    'users-people',
    {
      name: 180,
      email: 260,
      status: 100,
      twofa: 72,
      role: 100,
      ou: 120,
      lastLogin: 110,
    },
    { name: 120, email: 160, status: 80, twofa: 56, role: 72, ou: 80, lastLogin: 80 }
  );

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: AlertColor; action?: React.ReactNode }>({
    open: false, message: '', severity: 'info',
  });
  const showSnackbar = useCallback((message: string, severity: AlertColor = 'info', action?: React.ReactNode) => {
    setSnackbar({ open: true, message, severity, action });
  }, []);
  const closeSnackbar = useCallback(() => setSnackbar((s) => ({ ...s, open: false })), []);

  type ConfirmConfig = {
    title: string;
    description?: React.ReactNode;
    entities?: ConfirmEntity[];
    confirmLabel: string;
    cancelLabel?: string;
    danger?: boolean;
    onConfirm: () => Promise<void>;
  };
  const [confirmConfig, setConfirmConfig] = useState<ConfirmConfig | null>(null);

  // Stagger animation trigger
  useEffect(() => {
    const t = setTimeout(() => setAppeared(true), 60);
    return () => clearTimeout(t);
  }, []);

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const organizeOUsHierarchically = (ous: Array<{ orgUnitPath: string; name: string }>) => {
    const rootOU = ous.find((ou) => ou.orgUnitPath === '/');
    const otherOUs = ous.filter((ou) => ou.orgUnitPath !== '/');
    const childrenMap = new Map<string, Array<{ orgUnitPath: string; name: string }>>();
    otherOUs.forEach((ou) => {
      const parts = ou.orgUnitPath.split('/').filter(Boolean);
      const parentPath = '/' + parts.slice(0, -1).join('/');
      if (!childrenMap.has(parentPath)) childrenMap.set(parentPath, []);
      childrenMap.get(parentPath)!.push(ou);
    });
    childrenMap.forEach((c) => c.sort((a, b) => a.name.localeCompare(b.name)));
    const result: Array<{ orgUnitPath: string; name: string; displayName: string; level: number }> = [];
    if (rootOU) result.push({ orgUnitPath: rootOU.orgUnitPath, name: rootOU.name, displayName: rootOU.name, level: 0 });
    const walk = (parent: string, lvl: number) => {
      for (const child of childrenMap.get(parent) || []) {
        result.push({ orgUnitPath: child.orgUnitPath, name: child.name, displayName: child.name, level: lvl });
        walk(child.orgUnitPath, lvl + 1);
      }
    };
    walk('/', 1);
    return result;
  };

  const fetchOrganizationalUnits = async () => {
    try {
      setLoadingOrgUnits(true);
      const r = await apiClient.get('/users/organizational-units');
      setOrganizationalUnits(organizeOUsHierarchically(r.data));
    } catch {
      setOrganizationalUnits([{ orgUnitPath: '/', name: 'example.com', displayName: 'example.com', level: 0 }]);
    } finally { setLoadingOrgUnits(false); }
  };

  const fetchUsersWithout2FA = async () => {
    try {
      setUsersWithout2FALoading(true);
      const r = await apiClient.get('/audit/users-without-2fa');
      const d = r.data as {
        usersWithout2FA?: unknown[];
        usersEnforcedButNotEnrolled?: unknown[];
        statistics?: unknown;
      } | null;
      if (d && typeof d === 'object') {
        setUsersWithout2FAData({
          ...d,
          usersWithout2FA: Array.isArray(d.usersWithout2FA) ? d.usersWithout2FA.map(normalizeWorkspaceUser) : [],
          usersEnforcedButNotEnrolled: Array.isArray(d.usersEnforcedButNotEnrolled)
            ? d.usersEnforcedButNotEnrolled.map(normalizeWorkspaceUser)
            : [],
        });
      } else {
        setUsersWithout2FAData(null);
      }
    } catch (e) {
      setUsersWithout2FAData(null);
      showSnackbar(apiErrorMessage(e, 'Could not load 2FA audit data.'), 'error');
    } finally { setUsersWithout2FALoading(false); }
  };

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const r = await apiClient.get('/users?maxResults=100');
      const raw = Array.isArray(r.data) ? r.data : [];
      setUsers(raw.map(normalizeWorkspaceUser));
    } catch (e) {
      setUsers([]);
      showSnackbar(apiErrorMessage(e, 'Could not load people.'), 'error');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    apiClient
      .get('/auth/me')
      .then((r) => {
        const list = Array.isArray(r.data?.protectedUsers) ? r.data.protectedUsers : [];
        setProtectedUserEmails(new Set(list.map((e: string) => String(e).toLowerCase())));
      })
      .catch(() => setProtectedUserEmails(new Set()));
    void fetchUsers();
    void fetchUsersWithout2FA();
    void fetchOrganizationalUnits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Filtering & sorting
  // -------------------------------------------------------------------------

  useEffect(() => { applyFilters(); }, [users, filters]);

  const applyFilters = () => {
    let f = [...users];
    if (filters.search) {
      const s = filters.search.toLowerCase();
      f = f.filter((u) => u.name.fullName.toLowerCase().includes(s) || u.primaryEmail.toLowerCase().includes(s));
    }
    if (filters.status) f = f.filter((u) => (filters.status === 'active' ? !u.suspended : u.suspended));
    if (filters.role) f = f.filter((u) => (filters.role === 'admin' ? isWorkspaceAdmin(u) : !isWorkspaceAdmin(u)));
    if (filters.twoFA) {
      f = f.filter((u) => {
        if (filters.twoFA === 'enrolled') return u.isEnrolledIn2Sv;
        if (filters.twoFA === 'enforced') return u.isEnforcedIn2Sv && !u.isEnrolledIn2Sv;
        if (filters.twoFA === 'none') return !u.isEnforcedIn2Sv && !u.isEnrolledIn2Sv;
        return true;
      });
    }
    if (filters.createdFrom || filters.createdTo) {
      const s = new Date(filters.createdFrom || filters.createdTo); s.setHours(0, 0, 0, 0);
      const e = new Date(filters.createdTo || filters.createdFrom); e.setHours(23, 59, 59, 999);
      f = f.filter((u) => { if (!u.creationTime) return false; const t = new Date(u.creationTime); return t >= s && t <= e; });
    }
    if (filters.lastLoginFrom || filters.lastLoginTo) {
      const s = new Date(filters.lastLoginFrom || filters.lastLoginTo); s.setHours(0, 0, 0, 0);
      const e = new Date(filters.lastLoginTo || filters.lastLoginFrom); e.setHours(23, 59, 59, 999);
      f = f.filter((u) => { if (!u.lastLoginTime) return false; const t = new Date(u.lastLoginTime); return t >= s && t <= e; });
    }
    setFilteredUsers(f);
    setPage(0);
  };

  const handleFilterChange = (key: keyof UserFilters, value: string) => setFilters((p) => ({ ...p, [key]: value }));
  const clearFilters = () => setFilters({ search: '', status: '', role: '', twoFA: '', createdFrom: '', createdTo: '', lastLoginFrom: '', lastLoginTo: '' });
  const hasActiveFilters = () => Object.entries(filters).some(([k, v]) => k !== 'search' && v && v.trim() !== '');

  const activeFilterLabels = useMemo(() => {
    const tokens: Array<{ label: string; key: keyof UserFilters }> = [];
    if (filters.status) tokens.push({ label: filters.status === 'active' ? 'Active' : 'Suspended', key: 'status' });
    if (filters.role) tokens.push({ label: filters.role === 'admin' ? 'Admins' : 'People', key: 'role' });
    if (filters.twoFA) tokens.push({ label: filters.twoFA === 'enrolled' ? '2FA enrolled' : filters.twoFA === 'enforced' ? '2FA enforced' : 'No 2FA', key: 'twoFA' });
    if (filters.createdFrom) tokens.push({ label: `Created ${filters.createdFrom}${filters.createdTo && filters.createdTo !== filters.createdFrom ? ` \u2013 ${filters.createdTo}` : ''}`, key: 'createdFrom' });
    if (filters.lastLoginFrom) tokens.push({ label: `Login ${filters.lastLoginFrom}${filters.lastLoginTo && filters.lastLoginTo !== filters.lastLoginFrom ? ` \u2013 ${filters.lastLoginTo}` : ''}`, key: 'lastLoginFrom' });
    return tokens;
  }, [filters]);

  const getSortValue = (u: User, key: SortKey): string | number => {
    switch (key) {
      case 'name': return u.name.fullName.toLowerCase();
      case 'email': return u.primaryEmail.toLowerCase();
      case 'status': return u.suspended ? 1 : 0;
      case '2fa': return u.isEnrolledIn2Sv ? 0 : u.isEnforcedIn2Sv ? 1 : 2;
      case 'role': return u.isAdmin ? 0 : 1;
      case 'adminType': return describeAdminType(u).toLowerCase();
      case 'ou': return (u.orgUnitPath || '/').toLowerCase();
      case 'created': return u.creationTime ? new Date(u.creationTime).getTime() : 0;
      case 'lastLogin': return u.lastLoginTime ? new Date(u.lastLoginTime).getTime() : 0;
    }
  };

  const scopeFiltered = useMemo(() => {
    if (tab === 1) return filteredUsers.filter(isWorkspaceAdmin);
    return filteredUsers;
  }, [tab, filteredUsers]);

  const effectiveSortKey: SortKey = tab === 1 && sortKey === 'role' ? 'adminType' : sortKey;

  const sorted = useMemo(() => {
    const arr = [...scopeFiltered];
    arr.sort((a, b) => {
      const va = getSortValue(a, effectiveSortKey);
      const vb = getSortValue(b, effectiveSortKey);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [scopeFiltered, effectiveSortKey, sortDir]);

  const paged = useMemo(() => sorted.slice(page * rowsPerPage, (page + 1) * rowsPerPage), [sorted, page, rowsPerPage]);

  const usersWithout2FAList: User[] = usersWithout2FAData?.usersWithout2FA ?? [];
  const paged2FAUsers = useMemo(
    () => usersWithout2FAList.slice(twoFAPage * twoFARowsPerPage, (twoFAPage + 1) * twoFARowsPerPage),
    [usersWithout2FAList, twoFAPage, twoFARowsPerPage]
  );

  useEffect(() => {
    const last = Math.max(0, Math.ceil(sorted.length / rowsPerPage) - 1);
    if (page > last) setPage(last);
  }, [sorted.length, rowsPerPage, page]);

  useEffect(() => {
    const last = Math.max(0, Math.ceil(usersWithout2FAList.length / twoFARowsPerPage) - 1);
    if (twoFAPage > last) setTwoFAPage(last);
  }, [usersWithout2FAList.length, twoFARowsPerPage, twoFAPage]);

  useEffect(() => {
    setTwoFAPage(0);
    setPage(0);
  }, [tab]);

  useEffect(() => {
    if (tab === 1 && sortKey === 'role') setSortKey('adminType');
  }, [tab, sortKey]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  const formatRelative = (d?: string) => {
    if (!d) return 'Never';
    const diff = Date.now() - new Date(d).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  };

  const exportToCSV = (userList: User[], filename: string) => {
    if (!userList?.length) return;
    const headers = ['Name', 'Email', 'Admin', 'Suspended', '2FA Enrolled', '2FA Enforced', 'Org Unit', 'Created', 'Last Login'];
    const rows = userList.map((u) => [
      u.name.fullName, u.primaryEmail, u.isAdmin ? 'Yes' : 'No', u.suspended ? 'Yes' : 'No',
      u.isEnrolledIn2Sv ? 'Yes' : 'No', u.isEnforcedIn2Sv ? 'Yes' : 'No', u.orgUnitPath || '/',
      u.creationTime ? new Date(u.creationTime).toISOString() : '', u.lastLoginTime ? new Date(u.lastLoginTime).toISOString() : 'Never',
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => (v.includes(',') ? `"${v}"` : v)).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  const toggleUser = (email: string) => setSelectedUsers((prev) => { const n = new Set(prev); n.has(email) ? n.delete(email) : n.add(email); return n; });
  const allSelected = sorted.length > 0 && selectedUsers.size === sorted.length;
  const someSelected = selectedUsers.size > 0 && !allSelected;
  const toggleAll = () => setSelectedUsers(allSelected ? new Set() : new Set(sorted.map((u) => u.primaryEmail)));

  // -------------------------------------------------------------------------
  // Export handlers
  // -------------------------------------------------------------------------

  const handleExportAllCSV = async () => {
    try {
      const filename = generateExportFilename('people-all');
      const r = await apiClient.get('/users/export', { responseType: 'blob' });
      const blob = new Blob([r.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: filename }).click();
      URL.revokeObjectURL(url);
      showSnackbar('Your CSV is ready.', 'success');
    } catch { showSnackbar('Export failed. Try again.', 'error'); }
  };

  const handleExportAllDrive = async () => {
    try {
      const r = await apiClient.post('/users/export/drive');
      const link = r.data.webViewLink;
      if (link) window.open(link, '_blank');
      showSnackbar('Saved to Google Drive.', 'success', link ? <Button color="inherit" size="small" onClick={() => window.open(link, '_blank')}>Open</Button> : undefined);
    } catch { showSnackbar('Drive export failed.', 'error'); }
  };

  const handleExportSelectedCSV = async () => {
    if (!selectedUsers.size) { showSnackbar('Select people first.', 'warning'); return; }
    const filename = generateExportFilename('people-selected');
    try {
      const r = await apiClient.post('/users/export/selected', { userEmails: [...selectedUsers] }, { responseType: 'blob' });
      const blob = new Blob([r.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: filename }).click();
      URL.revokeObjectURL(url);
      showSnackbar('Selection exported.', 'success');
    } catch { showSnackbar('Export failed.', 'error'); }
  };

  const handleExportSelectedDrive = async () => {
    if (!selectedUsers.size) return;
    try {
      const r = await apiClient.post('/users/export/selected/drive', { userEmails: [...selectedUsers] });
      const link = r.data.webViewLink;
      if (link) window.open(link, '_blank');
      showSnackbar('Selection saved to Drive.', 'success', link ? <Button color="inherit" size="small" onClick={() => window.open(link, '_blank')}>Open</Button> : undefined);
    } catch { showSnackbar('Drive export failed.', 'error'); }
  };

  const handleExportFilteredCSV = async () => {
    if (!filteredUsers.length) { showSnackbar('No results to export.', 'warning'); return; }
    const filename = generateExportFilename('people-filtered');
    try {
      const r = await apiClient.post('/users/export/filtered', { filters }, { responseType: 'blob' });
      const blob = new Blob([r.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: filename }).click();
      URL.revokeObjectURL(url);
      showSnackbar('Filtered export ready.', 'success');
    } catch { showSnackbar('Export failed.', 'error'); }
  };

  const handleExportFilteredDrive = async () => {
    if (!filteredUsers.length) return;
    try {
      const r = await apiClient.post('/users/export/filtered/drive', { filters });
      const link = r.data.webViewLink;
      if (link) window.open(link, '_blank');
      showSnackbar('Filtered export in Drive.', 'success', link ? <Button color="inherit" size="small" onClick={() => window.open(link, '_blank')}>Open</Button> : undefined);
    } catch { showSnackbar('Drive export failed.', 'error'); }
  };

  // -------------------------------------------------------------------------
  // Edit dialog
  // -------------------------------------------------------------------------

  const handleOpenEdit = async (user: User) => {
    setEditDialogOpen(true);
    setSelectedUser(user);
    try {
      const { data } = await apiClient.get(`/users/${encodeURIComponent(user.primaryEmail)}`);
      setSelectedUser(data);
    } catch {
      // keep the list-state fallback already set above
    }
  };
  const handleCloseEdit = () => { setEditDialogOpen(false); setSelectedUser(null); };

  const selectedUserObjects = useMemo(
    () => users.filter((u) => selectedUsers.has(u.primaryEmail)),
    [users, selectedUsers]
  );

  const openBulkSuspend = () => {
    const targets = selectedUserObjects.filter((u) => !u.suspended);
    if (!targets.length) {
      showSnackbar('Selected accounts are already suspended.', 'info');
      return;
    }
    setConfirmConfig({
      title: `Suspend ${targets.length} user${targets.length === 1 ? '' : 's'}?`,
      description: (
        <Typography sx={{ fontFamily: T.font, fontSize: '0.875rem' }}>
          They will lose access to Google Workspace until reactivated. Admins can still be suspended; permanent delete is blocked for admin accounts.
        </Typography>
      ),
      confirmLabel: 'Suspend',
      cancelLabel: 'Cancel',
      danger: true,
      onConfirm: async () => {
        let ok = 0;
        let fail = 0;
        for (const u of targets) {
          try {
            await apiClient.patch(`/users/${encodeURIComponent(u.primaryEmail)}`, { suspended: true });
            ok += 1;
          } catch {
            fail += 1;
          }
        }
        setSelectedUsers(new Set());
        await fetchUsers();
        showSnackbar(
          fail ? `Suspended ${ok}, ${fail} failed.` : `Suspended ${ok} account${ok === 1 ? '' : 's'}.`,
          fail ? 'warning' : 'success'
        );
      },
    });
  };

  const openBulkDelete = () => {
    const blocked = selectedUserObjects.filter((u) => cannotDeleteUser(u, protectedUserEmails));
    const targets = selectedUserObjects.filter((u) => !cannotDeleteUser(u, protectedUserEmails));
    if (!targets.length) {
      showSnackbar(
        blocked.length
          ? 'Selected accounts are admins or protected and cannot be deleted here. Use Google Admin Console, or suspend instead.'
          : 'Nothing to delete.',
        'warning'
      );
      return;
    }
    setConfirmConfig({
      title: `Delete ${targets.length} ${targets.length === 1 ? 'person' : 'people'}?`,
      description: (
        <Box>
          <Typography sx={{ fontFamily: T.font, fontSize: '0.875rem', color: (t) => textSecondary(t) }}>
            This permanently removes the accounts from Workspace. There is no trash — this cannot be undone from AdminAssist.
          </Typography>
          {blocked.length > 0 && (
            <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textTertiary(t), mt: 1.5 }}>
              Skipping {blocked.length} admin or protected account{blocked.length === 1 ? '' : 's'}. Admins are never deleted from this app.
            </Typography>
          )}
          {blocked.length === 0 && (
            <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textTertiary(t), mt: 1.5 }}>
              Admins and protected accounts are never deleted from this app.
            </Typography>
          )}
        </Box>
      ),
      entities: targets.map((u) => ({ name: u.name.fullName, detail: u.primaryEmail })),
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
      onConfirm: async () => {
        let ok = 0;
        let fail = 0;
        for (const u of targets) {
          try {
            await apiClient.delete(`/users/${encodeURIComponent(u.primaryEmail)}`);
            ok += 1;
          } catch {
            fail += 1;
          }
        }
        setSelectedUsers(new Set());
        await fetchUsers();
        showSnackbar(
          fail ? `Deleted ${ok}, ${fail} failed.` : `Deleted ${ok} account${ok === 1 ? '' : 's'}.`,
          fail ? 'warning' : 'success'
        );
      },
    });
  };

  // -------------------------------------------------------------------------
  // 2FA actions
  // -------------------------------------------------------------------------

  const performBulk2FANotify = async (emails: string[]) => {
    try {
      setSending2FAEmails(true);
      const r = await apiClient.post('/audit/users-without-2fa/notify', { userEmails: emails });
      const { success, failed } = r.data;
      showSnackbar(failed ? `Sent ${success}, ${failed} failed.` : `${success} reminder${success === 1 ? '' : 's'} sent.`, failed ? 'warning' : 'success');
      setSelectedUsersWithout2FA(new Set());
    } catch (e: any) {
      showSnackbar(e?.response?.data?.error || 'Could not send reminders.', 'error');
      throw e;
    } finally { setSending2FAEmails(false); }
  };

  const openBulk2FAConfirm = () => {
    const list = usersWithout2FAData?.usersWithout2FA as User[] | undefined;
    if (!list?.length) return;
    const targets = selectedUsersWithout2FA.size > 0 ? [...selectedUsersWithout2FA] : list.map((u) => u.primaryEmail);
    setConfirmConfig({
      title: 'Send 2FA reminders?',
      description: <Typography variant="body2" color="text.secondary">{targets.length} people will receive an enrollment reminder.</Typography>,
      confirmLabel: 'Send',
      cancelLabel: 'Not now',
      onConfirm: async () => { await performBulk2FANotify(targets); },
    });
  };

  const openSingle2FAConfirm = (user: User) => {
    setConfirmConfig({
      title: 'Send a 2FA reminder?',
      description: <Typography variant="body2" color="text.secondary"><strong>{user.name.fullName}</strong> will receive setup instructions at {user.primaryEmail}.</Typography>,
      confirmLabel: 'Send',
      onConfirm: async () => {
        setSending2FAEmails(true);
        try {
          const r = await apiClient.post('/audit/users-without-2fa/notify', { userEmails: [user.primaryEmail] });
          showSnackbar(r.data.failed ? 'Could not deliver.' : 'Reminder sent.', r.data.failed ? 'error' : 'success');
        } finally { setSending2FAEmails(false); }
      },
    });
  };

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchFlyoutRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  // -------------------------------------------------------------------------
  // Derived
  // -------------------------------------------------------------------------

  const stats2FA = usersWithout2FAData?.statistics;
  const enrolled2FA = stats2FA ? stats2FA.total - stats2FA.without2FA : 0;
  const pct2FA = stats2FA?.total ? Math.round((enrolled2FA / stats2FA.total) * 100) : 0;
  const adminCount = useMemo(() => users.filter(isWorkspaceAdmin).length, [users]);
  const without2FACount = stats2FA?.without2FA ?? users.filter((u) => !u.isEnrolledIn2Sv).length;

  const peopleLede =
    tab === 2
      ? 'Users without 2-Step Verification. Nudge them or open Admin to enforce enrollment.'
      : 'Directory users across the Workspace. Open a row to edit profile, groups, and apps.';

  const peopleStatus =
    tab === 2 && stats2FA ? (
      <>
        {stats2FA.without2FA} need 2FA
        <Box component="span" className="page-status-faint">
          {` · of ${stats2FA.total} people · ${pct2FA}% enrolled`}
        </Box>
      </>
    ) : (
      <>
        {users.length} {users.length === 1 ? 'person' : 'people'}
        <Box component="span" className="page-status-faint">
          {` · ${adminCount} ${adminCount === 1 ? 'admin' : 'admins'} · ${without2FACount} without 2FA`}
          {hasActiveFilters() ? ' · filters applied' : ''}
        </Box>
      </>
    );

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (loading && users.length === 0) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 2, opacity: appeared ? 1 : 0, transition: 'opacity 0.4s ease' }}>
        <CircularProgress size={28} thickness={4} sx={{ color: T.accent }} />
        <Typography sx={{ fontFamily: T.font, fontSize: '0.875rem', color: (t) => textSecondary(t) }}>Loading your people…</Typography>
      </Box>
    );
  }

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <Box sx={{ fontFamily: T.font }}>

      <PageHeader
        title="People"
        lede={peopleLede}
        status={peopleStatus}
        actions={<SegmentedControl value={tab} options={['All', 'Admins', 'Needs 2FA']} onChange={setTab} />}
      />

      {/* ================================================================= */}
      {/* ALL USERS TAB                                                      */}
      {/* ================================================================= */}
      {(tab === 0 || tab === 1) && (
        <Fade in={true} timeout={300}>
          <Box>
            {/* Toolbar: search + filters + export */}
            <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
              <FlyoutSearch
                ref={searchFlyoutRef}
                value={filters.search}
                onChange={(v) => handleFilterChange('search', v)}
                placeholder={`Search people…  ${shortcut(['K'])}`}
                tooltip="Search people"
              />

              <ActionTooltip title="Filters">
                <IconButton
                  size="small"
                  onClick={() => setFiltersVisible((v) => !v)}
                  sx={(theme) => ({
                    color: filtersVisible || hasActiveFilters() ? T.accent : textSecondary(theme),
                    bgcolor: filtersVisible ? pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.2)') : 'transparent',
                    borderRadius: T.radiusSm,
                    '&:hover': { bgcolor: pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.2)') },
                  })}
                >
                  <ListFilter size={18} strokeWidth={1.75} />
                </IconButton>
              </ActionTooltip>

              <ActionTooltip title="Refresh">
                <IconButton size="small" onClick={fetchUsers} sx={{ color: (t) => textSecondary(t) }}>
                  <RefreshCw size={18} strokeWidth={1.75} />
                </IconButton>
              </ActionTooltip>

              <Box sx={{ flex: 1 }} />

              {selectedUsers.size > 0 && (
                <>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, color: T.accent }}>
                    {selectedUsers.size} selected
                  </Typography>
                  {canTakeAction && hasPermission('users.update') && (
                    <Button
                      size="small"
                      startIcon={<Ban size={15} strokeWidth={1.75} />}
                      onClick={openBulkSuspend}
                      sx={(th) => ({ ...dialogSecondaryButtonSx(th), minHeight: 32 })}
                    >
                      Suspend
                    </Button>
                  )}
                  {canTakeAction && hasPermission('users.delete') && (
                    <Button
                      size="small"
                      startIcon={<Trash2 size={15} strokeWidth={1.75} />}
                      onClick={openBulkDelete}
                      sx={(th) => ({ ...dialogDangerButtonSx(th), minHeight: 32, px: 1.5 })}
                    >
                      Delete
                    </Button>
                  )}
                </>
              )}

              <ExportButton
                iconOnly={!isMdUp}
                tooltipTitle="Export"
                totalItems={sorted.length}
                selectedCount={selectedUsers.size}
                hasFilters={hasActiveFilters()}
                onExportAllCSV={handleExportAllCSV}
                onExportAllDrive={handleExportAllDrive}
                onExportSelectedCSV={handleExportSelectedCSV}
                onExportSelectedDrive={handleExportSelectedDrive}
                onExportFilteredCSV={handleExportFilteredCSV}
                onExportFilteredDrive={handleExportFilteredDrive}
                disabled={sorted.length === 0}
                triggerSx={exportToolbarButtonSx()}
              />
            </Box>

            {/* Filter panel (collapsible) */}
            <Box sx={{ overflow: 'hidden', maxHeight: filtersVisible ? 320 : 0, transition: 'max-height 0.25s ease, opacity 0.2s ease', opacity: filtersVisible ? 1 : 0, mb: filtersVisible ? 2 : 0 }}>
              <Box sx={(theme) => ({
                display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center',
                p: 1.5, borderRadius: T.radius, border: `1px solid ${pick(theme, T.border, '#3f3f46')}`, bgcolor: pick(theme, T.surface, '#27272a'),
              })}>
                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <Select
                    value={filters.status} displayEmpty
                    renderValue={(v) => (v ? (v === 'active' ? 'Active' : 'Suspended') : 'Status')}
                    onChange={(e) => handleFilterChange('status', e.target.value)}
                    MenuProps={selectMenuProps}
                    sx={{ fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm }}
                  >
                    <MenuItem value="">Any</MenuItem>
                    <MenuItem value="active">Active</MenuItem>
                    <MenuItem value="suspended">Suspended</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 110 }}>
                  <Select
                    value={filters.role} displayEmpty
                    renderValue={(v) => (v ? (v === 'admin' ? 'Admin' : 'User') : 'Role')}
                    onChange={(e) => handleFilterChange('role', e.target.value)}
                    MenuProps={selectMenuProps}
                    sx={{ fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm }}
                  >
                    <MenuItem value="">Any</MenuItem>
                    <MenuItem value="admin">Admin</MenuItem>
                    <MenuItem value="user">User</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <Select
                    value={filters.twoFA} displayEmpty
                    renderValue={(v) => (v ? (v === 'enrolled' ? 'Enrolled' : v === 'enforced' ? 'Enforced' : 'No 2FA') : '2FA')}
                    onChange={(e) => handleFilterChange('twoFA', e.target.value)}
                    MenuProps={selectMenuProps}
                    sx={{ fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm }}
                  >
                    <MenuItem value="">Any</MenuItem>
                    <MenuItem value="enrolled">Enrolled</MenuItem>
                    <MenuItem value="enforced">Enforced</MenuItem>
                    <MenuItem value="none">Not enrolled</MenuItem>
                  </Select>
                </FormControl>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography component="span" sx={{ fontFamily: T.font, fontSize: '0.75rem', fontWeight: 500, color: (t) => textTertiary(t), whiteSpace: 'nowrap' }}>
                    Created date
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<Calendar size={18} strokeWidth={1.75} />}
                    onClick={(e) => setCreatedDateAnchor(e.currentTarget)}
                    sx={(theme) => ({
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
                    {formatFilterDateRange(filters.createdFrom, filters.createdTo)}
                  </Button>
                </Box>
                <Popover open={!!createdDateAnchor} anchorEl={createdDateAnchor} onClose={() => setCreatedDateAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
                  <Box sx={{ p: 2 }}>
                    <DateRangeCalendar mode="single-or-range" value={{ from: filters.createdFrom, to: filters.createdTo }} onChange={(v) => { const r = typeof v === 'string' ? { from: v, to: v } : v; handleFilterChange('createdFrom', r.from); handleFilterChange('createdTo', r.to); }} onClose={() => setCreatedDateAnchor(null)} />
                  </Box>
                </Popover>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography component="span" sx={{ fontFamily: T.font, fontSize: '0.75rem', fontWeight: 500, color: (t) => textTertiary(t), whiteSpace: 'nowrap' }}>
                    Last sign-in
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<Calendar size={18} strokeWidth={1.75} />}
                    onClick={(e) => setLastLoginDateAnchor(e.currentTarget)}
                    sx={(theme) => ({
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
                    {formatFilterDateRange(filters.lastLoginFrom, filters.lastLoginTo)}
                  </Button>
                </Box>
                <Popover open={!!lastLoginDateAnchor} anchorEl={lastLoginDateAnchor} onClose={() => setLastLoginDateAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
                  <Box sx={{ p: 2 }}>
                    <DateRangeCalendar mode="single-or-range" value={{ from: filters.lastLoginFrom, to: filters.lastLoginTo }} onChange={(v) => { const r = typeof v === 'string' ? { from: v, to: v } : v; handleFilterChange('lastLoginFrom', r.from); handleFilterChange('lastLoginTo', r.to); }} onClose={() => setLastLoginDateAnchor(null)} />
                  </Box>
                </Popover>
                {hasActiveFilters() && (
                  <Button size="small" onClick={clearFilters} sx={{ fontFamily: T.font, fontSize: '0.75rem', textTransform: 'none', color: (t) => textSecondary(t) }}>
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
                    if (t.key === 'createdFrom') { handleFilterChange('createdFrom', ''); handleFilterChange('createdTo', ''); }
                    else if (t.key === 'lastLoginFrom') { handleFilterChange('lastLoginFrom', ''); handleFilterChange('lastLoginTo', ''); }
                    else handleFilterChange(t.key, '');
                  }} />
                ))}
              </Box>
            )}

            {/* ======= TABLE ======= */}
            <ListShell>
              <ListHeaderRow>
                <Box sx={listCheckboxSx}>
                  <Checkbox
                    size="small"
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={toggleAll}
                    sx={{ p: 0.25 }}
                  />
                </Box>
                <Box sx={{ width: 34, flex: '0 0 34px' }} />
                <ColumnHeader
                  label="Name"
                  columnId="name"
                  sortConfig={{ key: effectiveSortKey, direction: sortDir }}
                  onSort={(id) => handleSort(id as SortKey)}
                  {...cols.headerProps('name')}
                />
                <ColumnHeader
                  label="Email"
                  columnId="email"
                  sortConfig={{ key: effectiveSortKey, direction: sortDir }}
                  onSort={(id) => handleSort(id as SortKey)}
                  {...cols.headerProps('email')}
                />
                <ColumnHeader
                  label="Status"
                  columnId="status"
                  sortConfig={{ key: effectiveSortKey, direction: sortDir }}
                  onSort={(id) => handleSort(id as SortKey)}
                  {...cols.headerProps('status')}
                />
                <ColumnHeader
                  label="2FA"
                  columnId="2fa"
                  sortConfig={{ key: effectiveSortKey, direction: sortDir }}
                  onSort={(id) => handleSort(id as SortKey)}
                  {...cols.headerProps('twofa')}
                />
                <ColumnHeader
                  label={isAdminsTab ? 'Admin type' : 'Role'}
                  columnId={isAdminsTab ? 'adminType' : 'role'}
                  sortConfig={{ key: effectiveSortKey, direction: sortDir }}
                  onSort={(id) => handleSort(id as SortKey)}
                  {...cols.headerProps('role')}
                />
                <ColumnHeader
                  label="OU"
                  columnId="ou"
                  sortConfig={{ key: effectiveSortKey, direction: sortDir }}
                  onSort={(id) => handleSort(id as SortKey)}
                  {...cols.headerProps('ou')}
                />
                {isMdUp && (
                  <ColumnHeader
                    label="Last sign-in"
                    columnId="lastLogin"
                    sortConfig={{ key: effectiveSortKey, direction: sortDir }}
                    onSort={(id) => handleSort(id as SortKey)}
                    {...cols.headerProps('lastLogin')}
                  />
                )}
                <ColumnHeader
                  label=""
                  columnId="__admin"
                  sortConfig={{ key: effectiveSortKey, direction: sortDir }}
                  onSort={() => {}}
                  width={36}
                  align="center"
                  sortable={false}
                  pinEnd
                />
                <ColumnHeader
                  label=""
                  columnId="__open"
                  sortConfig={{ key: effectiveSortKey, direction: sortDir }}
                  onSort={() => {}}
                  width={36}
                  align="right"
                  sortable={false}
                  pinEnd
                />
              </ListHeaderRow>

              {sorted.length === 0 ? (
                <Box sx={{ py: 6, textAlign: 'center' }}>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', fontWeight: 500, color: (t) => textSecondary(t), mb: 0.5 }}>
                    {users.length === 0
                      ? 'No people loaded yet'
                      : isAdminsTab
                        ? 'No admins match'
                        : 'No matches'}
                  </Typography>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textTertiary(t), mb: 2 }}>
                    {users.length === 0
                      ? 'Try refreshing or check the backend.'
                      : isAdminsTab
                        ? 'Try adjusting search or filters, or check Admin Console for delegated roles.'
                        : 'Adjust your search or filters.'}
                  </Typography>
                  {hasActiveFilters() && (
                    <Button size="small" variant="outlined" onClick={clearFilters} sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem' }}>
                      Clear filters
                    </Button>
                  )}
                </Box>
              ) : (
                paged.map((user, idx) => {
                  const isSelected = selectedUsers.has(user.primaryEmail);
                  return (
                    <ListDataRow
                      key={user.id}
                      last={idx === paged.length - 1}
                      selected={isSelected}
                      onClick={() => handleOpenEdit(user)}
                    >
                      <Box sx={listCheckboxSx} onClick={(e) => e.stopPropagation()}>
                        <Checkbox size="small" checked={isSelected} sx={{ p: 0.25 }} onChange={() => toggleUser(user.primaryEmail)} />
                      </Box>
                      <Initials name={user.name.fullName} suspended={user.suspended} />
                      <Box sx={cols.cellSx('name')}>
                        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: (theme) => pick(theme, T.text, '#fafafa'), textDecoration: user.suspended ? 'line-through' : 'none', opacity: user.suspended ? 0.5 : 1 }}>
                          {user.name.fullName}
                        </Typography>
                      </Box>
                      <Box sx={cols.cellSx('email')}>
                        <Typography sx={{ fontFamily: T.mono, fontSize: '0.75rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {user.primaryEmail}
                        </Typography>
                      </Box>
                      <Box sx={cols.cellSx('status')}>
                        <DotLabel
                          dotColor={user.suspended ? T.danger : T.success}
                          dotTooltip={user.suspended ? 'Suspended' : 'Active'}
                        >
                          {user.suspended ? 'Suspended' : 'Active'}
                        </DotLabel>
                      </Box>
                      <Box sx={cols.cellSx('twofa')}>
                        <DotLabel
                          dotColor={user.isEnrolledIn2Sv ? T.success : user.isEnforcedIn2Sv ? T.warning : textTertiary(theme)}
                          dotTooltip={user.isEnrolledIn2Sv ? 'Enrolled' : user.isEnforcedIn2Sv ? 'Enforced' : 'None'}
                        >
                          {user.isEnrolledIn2Sv ? 'On' : user.isEnforcedIn2Sv ? 'Enf.' : '—'}
                        </DotLabel>
                      </Box>
                      {isAdminsTab ? (
                        <Box sx={cols.cellSx('role')}>
                          <Tooltip title={describeAdminType(user)} placement="top">
                            <Typography
                              sx={{
                                fontFamily: T.font,
                                fontSize: '0.75rem',
                                fontWeight: 500,
                                color: (t) => (user.isAdmin ? T.accent : textSecondary(t)),
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {describeAdminType(user)}
                            </Typography>
                          </Tooltip>
                        </Box>
                      ) : (
                        <Box sx={cols.cellSx('role')}>
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', fontWeight: user.isAdmin ? 600 : 400, color: (t) => (user.isAdmin ? T.accent : textSecondary(t)) }}>
                            {isWorkspaceAdmin(user) ? 'Admin' : 'User'}
                          </Typography>
                        </Box>
                      )}
                      <Box sx={cols.cellSx('ou')}>
                        <Tooltip title={user.orgUnitPath || '/'} placement="top">
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {orgUnitLeaf(user.orgUnitPath)}
                          </Typography>
                        </Tooltip>
                      </Box>
                      {isMdUp && (
                        <Box sx={cols.cellSx('lastLogin')}>
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textTertiary(t) }}>
                            {formatRelative(user.lastLoginTime)}
                          </Typography>
                        </Box>
                      )}
                      <Box
                        sx={{ width: 36, flex: '0 0 36px', display: 'flex', justifyContent: 'center', opacity: 0.7 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ActionTooltip title="Open in Admin">
                          <IconButton
                            size="small"
                            component="a"
                            href={`https://admin.google.com/ac/users/${encodeURIComponent(user.primaryEmail)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{ color: (t) => textTertiary(t), p: 0.5 }}
                            aria-label="Open in Admin"
                          >
                            <ExternalLink size={14} strokeWidth={1.75} />
                          </IconButton>
                        </ActionTooltip>
                      </Box>
                      <Box sx={listActionsSx}>
                        <ListChevron />
                      </Box>
                    </ListDataRow>
                  );
                })
              )}
            </ListShell>

            {sorted.length > 0 && (
              <TablePagination
                component="div"
                count={sorted.length}
                page={page}
                onPageChange={(_, newPage) => setPage(newPage)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(e) => {
                  setRowsPerPage(parseInt(e.target.value, 10));
                  setPage(0);
                }}
                rowsPerPageOptions={[25, 50, 100]}
                {...tablePaginationProps(theme)}
              />
            )}
          </Box>
        </Fade>
      )}

      {/* ================================================================= */}
      {/* 2FA TAB                                                            */}
      {/* ================================================================= */}
      {tab === 2 && (
        <Fade in={true} timeout={300}>
          <Box>
            {usersWithout2FALoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                <CircularProgress size={28} thickness={4} sx={{ color: T.accent }} />
              </Box>
            ) : usersWithout2FAData ? (
              <>
                {/* Compact 2FA enrollment metric */}
                <Box
                  sx={(theme) => ({
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 2,
                    border: `1px solid ${pick(theme, T.border, '#3f3f46')}`,
                    borderRadius: T.radiusLg,
                    bgcolor: pick(theme, T.surface, '#18181b'),
                    px: 2.25,
                    py: 1.75,
                    mb: 2,
                  })}
                >
                  <ScoreRing
                    value={pct2FA}
                    size={56}
                    thickness={4}
                    color={pct2FA === 100 ? T.success : pct2FA >= 90 ? T.success : T.warning}
                    sizeVariant="sm"
                  />
                  <Box>
                    <Typography
                      sx={{
                        fontFamily: T.font,
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        color: (th) => pick(th, T.text, '#fafafa'),
                      }}
                    >
                      2FA enrollment
                    </Typography>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), mt: 0.25 }}>
                      {enrolled2FA} enrolled ·{' '}
                      <Box component="span" sx={{ color: T.warning }}>
                        {stats2FA?.without2FA || 0} remaining
                      </Box>
                    </Typography>
                  </Box>
                </Box>

                {/* Toolbar */}
                {usersWithout2FAData.usersWithout2FA?.length > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.75, flexWrap: 'wrap' }}>
                    <ActionTooltip title="Refresh">
                      <IconButton size="small" onClick={fetchUsersWithout2FA} sx={{ color: (t) => textSecondary(t) }}>
                        <RefreshCw size={18} strokeWidth={1.75} />
                      </IconButton>
                    </ActionTooltip>
                    <Box sx={{ flex: 1 }} />
                    {selectedUsersWithout2FA.size > 0 && (
                      <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, color: T.accent }}>
                        {selectedUsersWithout2FA.size} selected
                      </Typography>
                    )}
                    <ActionTooltip title={selectedUsersWithout2FA.size > 0 ? `Send to ${selectedUsersWithout2FA.size} selected` : 'Send reminders to all'}>
                      <span>
                        <Button
                          size="small"
                          variant="contained"
                          disableElevation
                          disabled={sending2FAEmails}
                          onClick={openBulk2FAConfirm}
                          startIcon={sending2FAEmails ? <CircularProgress size={14} color="inherit" /> : <Mail size={16} strokeWidth={1.75} />}
                          sx={{ fontFamily: T.font, fontSize: '0.8125rem', textTransform: 'none', borderRadius: T.radius, bgcolor: T.accent, '&:hover': { bgcolor: T.accentHover } }}
                        >
                          Send 2FA reminder
                        </Button>
                      </span>
                    </ActionTooltip>
                    <ExportButton
                      iconOnly={!isMdUp}
                      tooltipTitle="Export 2FA report"
                      totalItems={usersWithout2FAData.usersWithout2FA?.length || 0}
                      selectedCount={selectedUsersWithout2FA.size}
                      hasFilters={false}
                      onExportAllCSV={async () => {
                        const all: User[] = [...usersWithout2FAData.usersWithout2FA, ...(usersWithout2FAData.usersEnforcedButNotEnrolled || [])];
                        const filename = generateExportFilename('2fa-report');
                        exportToCSV(all, filename);
                        showSnackbar('CSV ready.', 'success');
                      }}
                      onExportAllDrive={async () => {
                        try {
                          const r = await apiClient.post('/audit/users-without-2fa/export/drive');
                          const link = r.data.webViewLink;
                          if (link) window.open(link, '_blank');
                          showSnackbar('Saved to Drive.', 'success');
                        } catch { showSnackbar('Export failed.', 'error'); }
                      }}
                      triggerSx={exportToolbarButtonSx()}
                    />
                  </Box>
                )}

                {/* 2FA user list */}
                {usersWithout2FAData.usersWithout2FA?.length > 0 && (
                  <>
                  <Box sx={(theme) => ({
                    border: `1px solid ${pick(theme, T.border, '#3f3f46')}`,
                    borderRadius: T.radiusLg,
                    overflow: 'hidden',
                    bgcolor: pick(theme, T.surface, '#18181b'),
                  })}>
                    {/* Header */}
                    <Box sx={(theme) => ({
                      display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25,
                      borderBottom: `1px solid ${pick(theme, T.borderSubtle, '#27272a')}`,
                    })}>
                      <Checkbox
                        size="small"
                        checked={usersWithout2FAData.usersWithout2FA.length > 0 && selectedUsersWithout2FA.size === usersWithout2FAData.usersWithout2FA.length}
                        indeterminate={selectedUsersWithout2FA.size > 0 && selectedUsersWithout2FA.size < usersWithout2FAData.usersWithout2FA.length}
                        onChange={(e) => setSelectedUsersWithout2FA(e.target.checked ? new Set(usersWithout2FAData.usersWithout2FA.map((u: User) => u.primaryEmail)) : new Set())}
                        sx={{ p: 0.25, mr: 0.5 }}
                      />
                      <Box sx={{ width: 34 }} />
                      <Typography sx={{ flex: 1, fontFamily: T.font, fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: (t) => textTertiary(t) }}>Person</Typography>
                      <Typography sx={{ width: 80, fontFamily: T.font, fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: (t) => textTertiary(t) }}>2FA</Typography>
                      <Typography sx={{ width: 80, fontFamily: T.font, fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: (t) => textTertiary(t) }}>Enforced</Typography>
                      <Box sx={{ width: 36 }} />
                    </Box>
                    {/* Rows */}
                    {paged2FAUsers.map((user: User, idx: number) => {
                      const isSelected = selectedUsersWithout2FA.has(user.primaryEmail);
                      return (
                        <Box
                          key={user.id}
                          sx={(theme) => ({
                            display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1,
                            borderBottom: idx < paged2FAUsers.length - 1 ? `1px solid ${pick(theme, T.borderSubtle, '#27272a')}` : 'none',
                            bgcolor: isSelected ? pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.16)') : 'transparent',
                            '&:hover': { bgcolor: isSelected ? pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.16)') : pick(theme, T.surfaceHover, '#27272a') },
                            '&:hover .notify-action': { opacity: 1 },
                            cursor: 'pointer',
                          })}
                          onClick={() => { const n = new Set(selectedUsersWithout2FA); n.has(user.primaryEmail) ? n.delete(user.primaryEmail) : n.add(user.primaryEmail); setSelectedUsersWithout2FA(n); }}
                        >
                          <Checkbox size="small" checked={isSelected} sx={{ p: 0.25, mr: 0.5 }} onClick={(e) => e.stopPropagation()} onChange={() => { const n = new Set(selectedUsersWithout2FA); n.has(user.primaryEmail) ? n.delete(user.primaryEmail) : n.add(user.primaryEmail); setSelectedUsersWithout2FA(n); }} />
                          <Initials name={user.name.fullName} />
                          <Box sx={{ flex: 1, overflow: 'hidden' }}>
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, color: (theme) => pick(theme, T.text, '#fafafa') }}>{user.name.fullName}</Typography>
                            <Typography sx={{ fontFamily: T.mono, fontSize: '0.6875rem', color: (t) => textTertiary(t) }}>{user.primaryEmail}</Typography>
                          </Box>
                          <Box sx={{ width: 80, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <StatusDot color={user.isEnrolledIn2Sv ? T.success : T.danger} label={user.isEnrolledIn2Sv ? 'Enrolled' : 'Not enrolled'} />
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: user.isEnrolledIn2Sv ? T.success : T.danger }}>{user.isEnrolledIn2Sv ? 'On' : 'Off'}</Typography>
                          </Box>
                          <Box sx={{ width: 80, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <StatusDot color={user.isEnforcedIn2Sv ? T.warning : textTertiary(theme)} label={user.isEnforcedIn2Sv ? 'Enforced' : 'Not enforced'} />
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textSecondary(t) }}>{user.isEnforcedIn2Sv ? 'Yes' : 'No'}</Typography>
                          </Box>
                          <Box className="notify-action" sx={{ width: 36, display: 'flex', justifyContent: 'center', opacity: 0, transition: 'opacity 0.15s ease' }} onClick={(e) => e.stopPropagation()}>
                            <ActionTooltip title="Send reminder">
                              <IconButton size="small" disabled={sending2FAEmails} onClick={() => openSingle2FAConfirm(user)} sx={{ color: T.accent }}>
                                <Mail size={16} strokeWidth={1.75} />
                              </IconButton>
                            </ActionTooltip>
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                  <TablePagination
                    component="div"
                    count={usersWithout2FAList.length}
                    page={twoFAPage}
                    onPageChange={(_, newPage) => setTwoFAPage(newPage)}
                    rowsPerPage={twoFARowsPerPage}
                    onRowsPerPageChange={(e) => {
                      setTwoFARowsPerPage(parseInt(e.target.value, 10));
                      setTwoFAPage(0);
                    }}
                    rowsPerPageOptions={[25, 50, 100]}
                    {...tablePaginationProps(theme)}
                  />
                  </>
                )}
              </>
            ) : (
              <Box sx={{ py: 8, textAlign: 'center' }}>
                <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', fontWeight: 500, color: (t) => textSecondary(t), mb: 0.5 }}>No 2FA data yet</Typography>
                <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textTertiary(t), mb: 2 }}>Pull the latest enrollment info from your directory.</Typography>
                <Button size="small" variant="outlined" onClick={fetchUsersWithout2FA} sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem' }}>
                  Refresh
                </Button>
              </Box>
            )}
          </Box>
        </Fade>
      )}

      {/* ================================================================= */}
      {/* SHARED OVERLAYS                                                    */}
      {/* ================================================================= */}

      <EditUserDialog
        open={editDialogOpen}
        user={selectedUser}
        organizationalUnits={organizationalUnits}
        loadingOrgUnits={loadingOrgUnits}
        onClose={handleCloseEdit}
        onSaved={fetchUsers}
        showSnackbar={showSnackbar}
      />

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={closeSnackbar} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={closeSnackbar} severity={snackbar.severity} sx={{ width: '100%', fontFamily: T.font, borderRadius: T.radius, alignItems: 'center' }} action={snackbar.action}>
          {snackbar.message}
        </Alert>
      </Snackbar>

      <ConfirmDialog
        open={confirmConfig !== null}
        title={confirmConfig?.title ?? ''}
        confirmLabel={confirmConfig?.confirmLabel}
        cancelLabel={confirmConfig?.cancelLabel}
        danger={confirmConfig?.danger}
        entities={confirmConfig?.entities}
        onClose={() => setConfirmConfig(null)}
        onConfirm={async () => { if (confirmConfig) await confirmConfig.onConfirm(); }}
      >
        {confirmConfig?.description}
      </ConfirmDialog>
    </Box>
  );
}
