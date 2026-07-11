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
  IconButton,
  Button,
  Checkbox,
  Tooltip,
  Alert,
  Snackbar,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  TablePagination,
  Popover,
  useMediaQuery,
} from '@mui/material';
import {
  Trash2,
  UserPlus,
  ListFilter,
  RefreshCw,
  Calendar,
  X,
  Plus,
  Check,
} from 'lucide-react';
import { apiClient } from '../services/api.client';
import { useTable, TableColumn } from '../hooks/useTable.tsx';
import { ExportButton } from '../components/ExportButton';
import { DateRangeCalendar } from '../components/DateRangeCalendar';
import { ActionTooltip } from '../components/ActionTooltip';
import { T, pick, selectMenuProps, textSecondary, textTertiary, exportToolbarButtonSx, dialogPaperSx, dialogDangerButtonSx } from '../theme/designTokens';
import { ColumnHeader } from '../components/ui/ColumnHeader';
import { ListShell, ListHeaderRow, ListDataRow, listActionsSx, listCheckboxSx } from '../components/ui/ListShell';
import { ListChevron } from '../components/ui/ListChevron';
import { FlyoutSearch, type FlyoutSearchHandle } from '../components/ui/FlyoutSearch';
import { DialogListPagination, DIALOG_LIST_PAGE_SIZE } from '../components/ui/DialogListPagination';
import { DIALOG_LIST_SORT, dialogListNoopSort } from '../components/ui/dialogListSort';
import { DotLabel } from '../components/StatusDot';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { FilterToken } from '../components/ui/FilterToken';
import { useTheme } from '@mui/material/styles';
import { useConfirm } from '../hooks/useConfirm';
import { useResizableColumns } from '../hooks/useResizableColumns';
import { getApiErrorMessage } from '../utils/apiError';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmailInput(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (EMAIL_RE.test(trimmed)) return trimmed;
  const inParens = trimmed.match(/\(([^\s@]+@[^\s@]+\.[^\s@]+)\)\s*$/)?.[1];
  return inParens || '';
}

interface Group {
  id: string;
  email: string;
  name: string;
  description?: string;
  directMembersCount?: number;
  creationTime?: string;
}

interface GroupFilters {
  search: string;
  createdFrom: string;
  createdTo: string;
  membership: string;
}

interface GroupMember {
  id: string;
  email: string;
  role: 'OWNER' | 'MANAGER' | 'MEMBER';
  type: 'USER' | 'GROUP' | 'CUSTOMER' | 'EXTERNAL';
  status: string;
}

interface User {
  id: string;
  primaryEmail: string;
  name: {
    givenName?: string;
    familyName?: string;
    fullName: string;
  };
}

export function Groups() {
  const theme = useTheme();
  const { confirm, confirmDialog } = useConfirm();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const cols = useResizableColumns(
    'groups',
    { name: 200, email: 260, description: 240, directMembersCount: 88, creationTime: 120 },
    { name: 120, email: 160, description: 120, directMembersCount: 56, creationTime: 88 }
  );
  const memberCols = useResizableColumns(
    'groups-members',
    { email: 280, role: 110, type: 100, status: 96 },
    { email: 160, role: 80, type: 72, status: 72 }
  );
  const pickerCols = useResizableColumns(
    'groups-user-picker',
    { name: 200, email: 260, description: 240, members: 88 },
    { name: 120, email: 160, description: 120, members: 56 }
  );
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [removingMembers, setRemovingMembers] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [deletingGroups, setDeletingGroups] = useState(false);
  const [tabValue, setTabValue] = useState(0);
  const [groupsWithExternalMembers, setGroupsWithExternalMembers] = useState<Group[]>([]);
  const [loadingExternal, setLoadingExternal] = useState(false);

  const noMemberGroups = useMemo(
    () =>
      (Array.isArray(groups) ? groups : []).filter((g) => {
        const count =
          typeof g.directMembersCount === 'number'
            ? g.directMembersCount
            : Number(String(g.directMembersCount ?? '0'));
        return Number.isFinite(count) ? count === 0 : true;
      }),
    [groups]
  );
  const dataSource = useMemo(() => {
    const raw = tabValue === 0 ? groups : tabValue === 1 ? groupsWithExternalMembers : noMemberGroups;
    return Array.isArray(raw) ? raw : [];
  }, [tabValue, groups, groupsWithExternalMembers, noMemberGroups]);

  const [filters, setFilters] = useState<GroupFilters>({
    search: '',
    createdFrom: '',
    createdTo: '',
    membership: '',
  });
  const [filtersVisible, setFiltersVisible] = useState(false);
  const searchFlyoutRef = useRef<FlyoutSearchHandle>(null);
  const exportAllCSVRef = useRef<() => void>(() => {});
  const exportSelectedCSVRef = useRef<() => void>(() => {});
  const [createdDateAnchor, setCreatedDateAnchor] = useState<HTMLElement | null>(null);

  const externalMemberEmails = useMemo(() => new Set(groupsWithExternalMembers.map(g => g.email)), [groupsWithExternalMembers]);

  const filteredDataSource = useMemo(() => {
    let result = [...dataSource];
    // Only apply accordion filters on All Groups tab
    if (tabValue !== 0) return result;

    if (filters.search.trim()) {
      const term = filters.search.toLowerCase();
      result = result.filter(
        g =>
          (g.name || '').toLowerCase().includes(term) ||
          (g.email || '').toLowerCase().includes(term) ||
          (g.description || '').toLowerCase().includes(term)
      );
    }
    if (filters.createdFrom || filters.createdTo) {
      const startStr = filters.createdFrom || filters.createdTo;
      const endStr = filters.createdTo || filters.createdFrom;
      const start = new Date(startStr); start.setHours(0, 0, 0, 0);
      const end = new Date(endStr); end.setHours(23, 59, 59, 999);
      result = result.filter(g => {
        if (!g.creationTime) return false;
        const t = new Date(g.creationTime);
        return t >= start && t <= end;
      });
    }
    if (filters.membership === 'external') {
      result = result.filter(g => externalMemberEmails.has(g.email));
    } else if (filters.membership === 'no-members') {
      result = result.filter(g => (g.directMembersCount || 0) === 0);
    }
    return result;
  }, [dataSource, filters, externalMemberEmails, tabValue]);

  // Define table columns
  const columns: TableColumn<Group>[] = [
    {
      id: 'name',
      label: 'Name',
      sortable: true,
      getValue: (row) => row.name,
    },
    {
      id: 'email',
      label: 'Email',
      sortable: true,
      getValue: (row) => row.email,
    },
    {
      id: 'description',
      label: 'Description',
      sortable: true,
      getValue: (row) => row.description || '',
    },
    {
      id: 'directMembersCount',
      label: 'Members',
      sortable: true,
      align: 'left',
      getValue: (row) => row.directMembersCount || 0,
    },
    {
      id: 'creationTime',
      label: 'Created',
      sortable: true,
      getValue: (row) => (row.creationTime ? new Date(row.creationTime).getTime() : 0),
    },
  ];

  // Use table hook (no search term - search is in Filters accordion)
  const {
    filteredData,
    page,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    sortConfig,
    handleSort,
  } = useTable(filteredDataSource, columns, 'name');

  const filteredGroups = filteredData;
  const hasActiveFilters = () =>
    tabValue === 0 &&
    [filters.search, filters.createdFrom, filters.createdTo, filters.membership].some(
      v => v && String(v).trim() !== ''
    );

  const handleFilterChange = (key: keyof GroupFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      createdFrom: '',
      createdTo: '',
      membership: '',
    });
    setFiltersVisible(false);
  };

  useEffect(() => {
    if (tabValue === 1 && groupsWithExternalMembers.length === 0 && !loadingExternal) {
      const fetchExternal = async () => {
        setLoadingExternal(true);
        try {
          const res = await apiClient.get('/groups/with-external-members?maxResults=500');
          setGroupsWithExternalMembers(Array.isArray(res.data) ? res.data : []);
        } catch (e) {
          console.error('Error fetching groups with external members:', e);
          setGroupsWithExternalMembers([]);
        } finally {
          setLoadingExternal(false);
        }
      };
      fetchExternal();
    }
  }, [tabValue, groupsWithExternalMembers.length, loadingExternal]);

  useEffect(() => {
    setPage(0);
    setSelectedGroups([]);
  }, [tabValue, setPage]);


  const handleSelectAllGroups = () => {
    if (selectedGroups.length === filteredGroups.length) {
      setSelectedGroups([]);
    } else {
      setSelectedGroups(filteredGroups.map(g => g.email));
    }
  };

  const [addUserDialogOpen, setAddUserDialogOpen] = useState(false);
  const [membersDialogPage, setMembersDialogPage] = useState(0);
  const [addUserGroupsPage, setAddUserGroupsPage] = useState(0);
  const [membersRowsPerPage, setMembersRowsPerPage] = useState(DIALOG_LIST_PAGE_SIZE);
  const [addUserGroupsRowsPerPage, setAddUserGroupsRowsPerPage] = useState(DIALOG_LIST_PAGE_SIZE);
  const [userEmailToAdd, setUserEmailToAdd] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [selectedGroupsForUser, setSelectedGroupsForUser] = useState<string[]>([]);
  const [userRole, setUserRole] = useState<'OWNER' | 'MANAGER' | 'MEMBER'>('MEMBER');
  const [addingUser, setAddingUser] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  useEffect(() => {
    fetchGroups();
  }, []);

  const handleExportAllCSV = () => {
    if (dataSource.length === 0) return;
    const csvData = dataSource.map(group => ({
      'Name': group.name,
      'Email': group.email,
      'Description': group.description || '',
      'Members': group.directMembersCount || 0,
      'Created': group.creationTime ? new Date(group.creationTime).toISOString() : '',
    }));
    const headers = Object.keys(csvData[0] || {});
    const csvRows = [headers.join(',')];
    for (const row of csvData) {
      const values = headers.map(header => {
        const value = row[header as keyof typeof row];
        if (value === null || value === undefined) return '';
        const stringValue = String(value).replace(/"/g, '""');
        return stringValue.includes(',') ? `"${stringValue}"` : stringValue;
      });
      csvRows.push(values.join(','));
    }
    const csv = csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Groups_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    setSnackbar({ open: true, message: 'CSV downloading now.', severity: 'success' });
  };
  const handleExportSelectedCSV = () => {
    const selectedGroupList = filteredGroups.filter(g => selectedGroups.includes(g.email));
    if (selectedGroupList.length === 0) return;
    const csvData = selectedGroupList.map(group => ({
      'Name': group.name,
      'Email': group.email,
      'Description': group.description || '',
      'Members': group.directMembersCount || 0,
      'Created': group.creationTime ? new Date(group.creationTime).toISOString() : '',
    }));
    const headers = Object.keys(csvData[0] || {});
    const csvRows = [headers.join(',')];
    for (const row of csvData) {
      const values = headers.map(header => {
        const value = row[header as keyof typeof row];
        if (value === null || value === undefined) return '';
        const stringValue = String(value).replace(/"/g, '""');
        return stringValue.includes(',') ? `"${stringValue}"` : stringValue;
      });
      csvRows.push(values.join(','));
    }
    const csv = csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Groups-selected-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    setSnackbar({ open: true, message: 'Selected groups exported.', severity: 'success' });
  };
  const handleExportFilteredCSV = () => {
    if (filteredGroups.length === 0) return;
    const csvData = filteredGroups.map(group => ({
      'Name': group.name,
      'Email': group.email,
      'Description': group.description || '',
      'Members': group.directMembersCount || 0,
      'Created': group.creationTime ? new Date(group.creationTime).toISOString() : '',
    }));
    const headers = Object.keys(csvData[0] || {});
    const csvRows = [headers.join(',')];
    for (const row of csvData) {
      const values = headers.map(header => {
        const value = row[header as keyof typeof row];
        if (value === null || value === undefined) return '';
        const stringValue = String(value).replace(/"/g, '""');
        return stringValue.includes(',') ? `"${stringValue}"` : stringValue;
      });
      csvRows.push(values.join(','));
    }
    const csv = csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Groups-filtered-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    setSnackbar({ open: true, message: 'Filtered groups exported.', severity: 'success' });
  };
  const handleExportAllDrive = async () => {
    try {
      const response = await apiClient.post('/groups/export/drive');
      if (response.data?.webViewLink) window.open(response.data.webViewLink, '_blank');
      setSnackbar({ open: true, message: 'Saved to Google Drive.', severity: 'success' });
    } catch (err: any) {
      console.error(err);
      setSnackbar({ open: true, message: err?.response?.data?.error || 'Drive export failed.', severity: 'error' });
    }
  };
  const handleExportSelectedDrive = async () => {
    if (selectedGroups.length === 0) return;
    try {
      const response = await apiClient.post('/groups/export/selected/drive', { groupEmails: selectedGroups });
      if (response.data?.webViewLink) window.open(response.data.webViewLink, '_blank');
      setSnackbar({ open: true, message: 'Selection saved to Google Drive.', severity: 'success' });
    } catch (err: any) {
      console.error(err);
      setSnackbar({ open: true, message: err?.response?.data?.error || 'Drive export failed.', severity: 'error' });
    }
  };
  const handleExportFilteredDrive = async () => {
    try {
      const response = await apiClient.post('/groups/export/drive', { maxResults: 5000 });
      if (response.data?.webViewLink) window.open(response.data.webViewLink, '_blank');
      setSnackbar({ open: true, message: 'Filtered export saved to Google Drive.', severity: 'success' });
    } catch (err: any) {
      console.error(err);
      setSnackbar({ open: true, message: err?.response?.data?.error || 'Drive export failed.', severity: 'error' });
    }
  };

  exportAllCSVRef.current = handleExportAllCSV;
  exportSelectedCSVRef.current = handleExportSelectedCSV;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (tabValue === 0) searchFlyoutRef.current?.focus();
      }
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        if (tabValue === 0) setFiltersVisible(v => !v);
      }
      if (tabValue === 0) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
          e.preventDefault();
          e.stopPropagation();
          const fn = selectedGroups.length > 0 ? exportSelectedCSVRef.current : exportAllCSVRef.current;
          if (typeof fn === 'function') fn();
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
          e.preventDefault();
          if (selectedGroups.length > 0) handleExportSelectedDrive();
          else if (hasActiveFilters()) handleExportFilteredDrive();
          else handleExportAllDrive();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [tabValue, selectedGroups.length]);

  const fetchGroups = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/groups?maxResults=1000');
      setGroups(Array.isArray(response?.data) ? response.data : []);
      setLoadError(null);
      if (tabValue === 1) {
        setGroupsWithExternalMembers([]);
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
      setGroups([]);
      setLoadError(getApiErrorMessage(error, 'Failed to load groups'));
    } finally {
      setLoading(false);
    }
  };


  const handleBulkDeleteGroups = async () => {
    if (selectedGroups.length === 0) return;
    if (!(await confirm({ title: `Delete ${selectedGroups.length} groups?`, message: 'This cannot be undone.', danger: true, confirmLabel: 'Delete' }))) return;
    try {
      setDeletingGroups(true);
      await Promise.all(selectedGroups.map(email => apiClient.delete(`/groups/${encodeURIComponent(email)}`)));
      setGroups(prev => prev.filter(g => !selectedGroups.includes(g.email)));
      setSelectedGroups([]);
      setSnackbar({ open: true, message: `${selectedGroups.length} group(s) deleted successfully`, severity: 'success' });
    } catch (error: any) {
      console.error('Error deleting groups:', error);
      setSnackbar({ open: true, message: getApiErrorMessage(error, 'Failed to delete groups'), severity: 'error' });
    } finally {
      setDeletingGroups(false);
    }
  };

  const handleOpenEditDialog = async (group: Group) => {
    setSelectedGroup(group);
    setEditDialogOpen(true);
    setSelectedMembers([]);
    await fetchMembers(group.email);
  };

  const [memberSearchTerm, setMemberSearchTerm] = useState('');
  const [addMemberInlineOpen, setAddMemberInlineOpen] = useState(false);
  const [addMemberEmail, setAddMemberEmail] = useState('');
  const [addMemberRole, setAddMemberRole] = useState<'MEMBER' | 'MANAGER' | 'OWNER'>('MEMBER');
  const [addingMember, setAddingMember] = useState(false);
  const directorySuggestions = useMemo(
    () =>
      users.map((user) =>
        user.name?.fullName ? `${user.name.fullName} (${user.primaryEmail})` : user.primaryEmail
      ),
    [users]
  );

  const handleCloseEditDialog = () => {
    setEditDialogOpen(false);
    setSelectedGroup(null);
    setMembers([]);
    setSelectedMembers([]);
    setMemberSearchTerm('');
    setAddMemberInlineOpen(false);
    setAddMemberEmail('');
    setAddMemberRole('MEMBER');
  };



  const filteredMembersForDialog = useMemo(() => {
    if (!memberSearchTerm.trim()) return members;
    const term = memberSearchTerm.trim().toLowerCase();
    return members.filter(m => (m.email || '').toLowerCase().includes(term));
  }, [members, memberSearchTerm]);

  const membersMaxPage = Math.max(0, Math.ceil(filteredMembersForDialog.length / membersRowsPerPage) - 1);
  const membersPageSafe = Math.min(membersDialogPage, membersMaxPage);
  const pagedMembersForDialog = useMemo(() => {
    const start = membersPageSafe * membersRowsPerPage;
    return filteredMembersForDialog.slice(start, start + membersRowsPerPage);
  }, [filteredMembersForDialog, membersPageSafe, membersRowsPerPage]);

  const agMaxPage = Math.max(0, Math.ceil(groups.length / addUserGroupsRowsPerPage) - 1);
  const agPageSafe = Math.min(addUserGroupsPage, agMaxPage);
  const pagedGroupsForPicker = useMemo(() => {
    const start = agPageSafe * addUserGroupsRowsPerPage;
    return groups.slice(start, start + addUserGroupsRowsPerPage);
  }, [groups, agPageSafe, addUserGroupsRowsPerPage]);

  useEffect(() => {
    const max = Math.max(0, Math.ceil(filteredMembersForDialog.length / membersRowsPerPage) - 1);
    setMembersDialogPage((p) => Math.min(p, max));
  }, [filteredMembersForDialog.length, membersRowsPerPage]);

  useEffect(() => {
    if (!editDialogOpen) return;
    setMembersDialogPage(0);
  }, [editDialogOpen, selectedGroup?.email]);

  useEffect(() => {
    setMembersDialogPage(0);
  }, [memberSearchTerm]);

  useEffect(() => {
    const max = Math.max(0, Math.ceil(groups.length / addUserGroupsRowsPerPage) - 1);
    setAddUserGroupsPage((p) => Math.min(p, max));
  }, [groups.length, addUserGroupsRowsPerPage]);

  useEffect(() => {
    if (!addUserDialogOpen) return;
    setAddUserGroupsPage(0);
  }, [addUserDialogOpen]);

  useEffect(() => {
    if (!addMemberInlineOpen || loadingUsers || users.length > 0) return;
    void fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addMemberInlineOpen, loadingUsers, users.length]);

  const fetchMembers = async (groupEmail: string) => {
    try {
      setLoadingMembers(true);
      const response = await apiClient.get(`/groups/${encodeURIComponent(groupEmail)}/members`);
      setMembers(response.data);
    } catch (error: any) {
      console.error('Error fetching members:', error);
      setSnackbar({ open: true, message: error.response?.data?.error || 'Failed to fetch members', severity: 'error' });
    } finally {
      setLoadingMembers(false);
    }
  };

  const handleRemoveMember = async (memberEmail: string) => {
    if (!selectedGroup) return;

    try {
      await apiClient.delete(`/groups/${encodeURIComponent(selectedGroup.email)}/members/${encodeURIComponent(memberEmail)}`);
      setMembers(members.filter(m => m.email !== memberEmail));
      setSnackbar({ open: true, message: 'Member removed successfully', severity: 'success' });
      fetchGroups(); // Refresh to update member count
    } catch (error: any) {
      console.error('Error removing member:', error);
      setSnackbar({ open: true, message: error.response?.data?.error || 'Failed to remove member', severity: 'error' });
    }
  };

  const handleSelectMember = (memberEmail: string) => {
    setSelectedMembers(prev =>
      prev.includes(memberEmail)
        ? prev.filter(email => email !== memberEmail)
        : [...prev, memberEmail]
    );
  };

  const handleRemoveSelectedMembers = async () => {
    if (!selectedGroup || selectedMembers.length === 0) return;

    try {
      setRemovingMembers(true);
      await Promise.all(
        selectedMembers.map(memberEmail =>
          apiClient.delete(`/groups/${encodeURIComponent(selectedGroup.email)}/members/${encodeURIComponent(memberEmail)}`)
        )
      );
      setMembers(members.filter(m => !selectedMembers.includes(m.email)));
      setSelectedMembers([]);
      setSnackbar({ open: true, message: `${selectedMembers.length} member(s) removed successfully`, severity: 'success' });
      fetchGroups(); // Refresh to update member count
    } catch (error: any) {
      console.error('Error removing members:', error);
      setSnackbar({ open: true, message: error.response?.data?.error || 'Failed to remove members', severity: 'error' });
    } finally {
      setRemovingMembers(false);
    }
  };

  const handleAddMember = async () => {
    if (!selectedGroup) return;
    const normalizedMemberEmail = normalizeEmailInput(addMemberEmail);
    if (!normalizedMemberEmail) {
      setSnackbar({ open: true, message: 'Enter a valid member email.', severity: 'error' });
      return;
    }
    try {
      setAddingMember(true);
      await apiClient.post(`/groups/${encodeURIComponent(selectedGroup.email)}/members`, {
        memberEmail: normalizedMemberEmail,
        role: addMemberRole,
      });
      setAddMemberInlineOpen(false);
      setAddMemberEmail('');
      setAddMemberRole('MEMBER');
      setSnackbar({ open: true, message: 'Member added successfully', severity: 'success' });
      await fetchMembers(selectedGroup.email);
      fetchGroups();
    } catch (error: any) {
      setSnackbar({ open: true, message: error.response?.data?.error || 'Failed to add member', severity: 'error' });
    } finally {
      setAddingMember(false);
    }
  };

  const handleSelectGroup = (groupEmail: string) => {
    setSelectedGroups(prev =>
      prev.includes(groupEmail)
        ? prev.filter(email => email !== groupEmail)
        : [...prev, groupEmail]
    );
  };

  const handleOpenAddUserDialog = async () => {
    setAddUserDialogOpen(true);
    setUserEmailToAdd('');
    setSelectedUser(null);
    setSelectedGroupsForUser([]);
    setUserRole('MEMBER');
    await fetchUsers();
  };

  const fetchUsers = async () => {
    try {
      setLoadingUsers(true);
      const response = await apiClient.get('/users?maxResults=500');
      // Sort users alphabetically by full name, then by email
      const sortedUsers = response.data.sort((a: User, b: User) => {
        const nameA = a.name.fullName.toLowerCase();
        const nameB = b.name.fullName.toLowerCase();
        if (nameA !== nameB) {
          return nameA.localeCompare(nameB);
        }
        return a.primaryEmail.toLowerCase().localeCompare(b.primaryEmail.toLowerCase());
      });
      setUsers(sortedUsers);
    } catch (error: any) {
      console.error('Error fetching users:', error);
      setSnackbar({ open: true, message: error.response?.data?.error || 'Failed to fetch users', severity: 'error' });
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleCloseAddUserDialog = () => {
    setAddUserDialogOpen(false);
    setUserEmailToAdd('');
    setSelectedUser(null);
    setSelectedGroupsForUser([]);
    setUserRole('MEMBER');
    setAutocompleteOpen(false);
  };

  const handleSelectGroupForUser = (groupEmail: string) => {
    setSelectedGroupsForUser(prev =>
      prev.includes(groupEmail)
        ? prev.filter(email => email !== groupEmail)
        : [...prev, groupEmail]
    );
  };

  const handleSelectAllGroupsForUser = () => {
    if (selectedGroupsForUser.length === groups.length) {
      setSelectedGroupsForUser([]);
    } else {
      setSelectedGroupsForUser(groups.map(g => g.email));
    }
  };

  const handleAddUserToGroups = async () => {
    const emailToUse = selectedUser?.primaryEmail || normalizeEmailInput(userEmailToAdd);
    if (!emailToUse || selectedGroupsForUser.length === 0) return;

    try {
      setAddingUser(true);
      const results = await Promise.allSettled(
        selectedGroupsForUser.map(groupEmail =>
          apiClient.post(`/groups/${encodeURIComponent(groupEmail)}/members`, {
            memberEmail: emailToUse,
            role: userRole,
          })
        )
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      if (failed === 0) {
        setSnackbar({
          open: true,
          message: `User added to ${successful} group(s) successfully`,
          severity: 'success',
        });
        handleCloseAddUserDialog();
        fetchGroups(); // Refresh to update member counts
      } else if (successful > 0) {
        setSnackbar({
          open: true,
          message: `User added to ${successful} group(s), but ${failed} failed. Some groups may already contain this user.`,
          severity: 'error',
        });
        fetchGroups(); // Refresh to update member counts
      } else {
        const firstError = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
        setSnackbar({
          open: true,
          message: firstError.reason?.response?.data?.error || 'Failed to add user to groups',
          severity: 'error',
        });
      }
    } catch (error: any) {
      console.error('Error adding user to groups:', error);
      setSnackbar({ open: true, message: error.response?.data?.error || 'Failed to add user to groups', severity: 'error' });
    } finally {
      setAddingUser(false);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '–';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const pageRows = filteredGroups.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const activeFilterLabels = useMemo(() => {
    const labels: { key: string; label: string }[] = [];
    if (filters.membership === 'external') labels.push({ key: 'membership', label: 'External members' });
    else if (filters.membership === 'no-members') labels.push({ key: 'membership', label: 'No members' });
    if (filters.createdFrom || filters.createdTo) {
      const dateLabel = filters.createdFrom === filters.createdTo
        ? filters.createdFrom
        : `${filters.createdFrom || '…'} – ${filters.createdTo || '…'}`;
      labels.push({ key: 'createdFrom', label: `Created: ${dateLabel}` });
    }
    return labels;
  }, [filters]);

  return (
    <Box sx={{ fontFamily: T.font }}>
      <Box sx={{ mb: 3, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, alignItems: { md: 'center' }, justifyContent: 'space-between' }}>
        <Typography sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.02em', color: (theme) => pick(theme, T.text, '#fafafa') }}>
          Groups
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <SegmentedControl value={tabValue} options={['All Groups', 'Externally Shared', 'No Members']} onChange={setTabValue} />
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {tabValue === 0 && (
          <FlyoutSearch
            ref={searchFlyoutRef}
            value={filters.search}
            onChange={(v) => handleFilterChange('search', v)}
            placeholder="Search groups…"
            tooltip="Search groups"
          />
        )}
        {tabValue === 0 && (
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
        )}
        <ActionTooltip title="Refresh data">
          <IconButton
            size="small"
            onClick={() => {
              fetchGroups();
              if (tabValue === 1) {
                setLoadingExternal(true);
                apiClient
                  .get('/groups/with-external-members?maxResults=500')
                  .then((res) => setGroupsWithExternalMembers(Array.isArray(res?.data) ? res.data : []))
                  .catch(() => setGroupsWithExternalMembers([]))
                  .finally(() => setLoadingExternal(false));
              }
            }}
            aria-label="Refresh data"
            sx={{ color: (t: any) => textSecondary(t) }}
          >
            <RefreshCw size={18} strokeWidth={1.75} />
          </IconButton>
        </ActionTooltip>
        <Box sx={{ flex: 1 }} />
        {selectedGroups.length > 0 && (
          <>
            <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t: any) => textSecondary(t) }}>
              {selectedGroups.length} selected
            </Typography>
            <Button
              size="small"
              startIcon={<Trash2 size={15} strokeWidth={1.75} />}
              onClick={handleBulkDeleteGroups}
              disabled={deletingGroups}
              sx={(th) => ({ ...dialogDangerButtonSx(th), minHeight: 32, px: 1.5 })}
            >
              Delete
            </Button>
          </>
        )}
        <Button
          size="small"
          variant="contained"
          onClick={handleOpenAddUserDialog}
          startIcon={<UserPlus size={15} strokeWidth={1.75} />}
          aria-label="Add user to groups"
          sx={{
            fontFamily: T.font,
            textTransform: 'none',
            borderRadius: T.radius,
            fontSize: '0.8125rem',
            fontWeight: 600,
            px: 1.5,
            border: 'none',
            bgcolor: T.accent,
            color: '#ffffff',
            boxShadow: 'none',
            '&:hover': {
              border: 'none',
              bgcolor: T.accentHover,
              boxShadow: 'none',
            },
          }}
        >
          Add user to groups
        </Button>
        <ExportButton
          iconOnly={!isMdUp}
          tooltipTitle="Export"
          totalItems={filteredGroups.length}
          selectedCount={selectedGroups.length}
          hasFilters={hasActiveFilters()}
          onExportAllCSV={handleExportAllCSV}
          onExportSelectedCSV={handleExportSelectedCSV}
          onExportFilteredCSV={handleExportFilteredCSV}
          onExportAllDrive={handleExportAllDrive}
          onExportSelectedDrive={handleExportSelectedDrive}
          onExportFilteredDrive={handleExportFilteredDrive}
          triggerSx={exportToolbarButtonSx()}
        />
      </Box>

      {tabValue === 0 && (
        <Box sx={{ overflow: 'hidden', maxHeight: filtersVisible ? 320 : 0, opacity: filtersVisible ? 1 : 0, transition: 'max-height 0.3s ease, opacity 0.2s ease, margin 0.3s ease', mb: filtersVisible ? 2 : 0 }}>
          <Box sx={(theme: any) => ({ p: 1.5, borderRadius: T.radius, border: `1px solid ${pick(theme, T.border, '#3f3f46')}`, bgcolor: pick(theme, T.surface, '#27272a'), display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' })}>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel sx={{ fontFamily: T.font, fontSize: '0.8125rem' }}>Membership</InputLabel>
              <Select
                value={filters.membership}
                label="Membership"
                onChange={(e) => handleFilterChange('membership', e.target.value)}
                sx={{ fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radius }}
                MenuProps={selectMenuProps}
              >
                <MenuItem value="">All</MenuItem>
                <MenuItem value="external">With external members</MenuItem>
                <MenuItem value="no-members">No members</MenuItem>
              </Select>
            </FormControl>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t: any) => textSecondary(t) }}>Created:</Typography>
              {filters.createdFrom && filters.createdTo && (
                <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t: any) => pick(t, T.text, '#fafafa') }}>
                  {filters.createdFrom === filters.createdTo ? filters.createdFrom : `${filters.createdFrom} – ${filters.createdTo}`}
                </Typography>
              )}
              <ActionTooltip title="Pick date or range">
                <IconButton size="small" onClick={(e) => setCreatedDateAnchor(e.currentTarget)} sx={{ color: (t: any) => textSecondary(t) }}>
                  <Calendar size={18} strokeWidth={1.75} />
                </IconButton>
              </ActionTooltip>
              <Popover
                open={Boolean(createdDateAnchor)}
                anchorEl={createdDateAnchor}
                onClose={() => setCreatedDateAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                PaperProps={{ sx: { minWidth: 280 } }}
              >
                <Box sx={{ p: 2 }}>
                  <DateRangeCalendar
                    mode="single-or-range"
                    value={{ from: filters.createdFrom, to: filters.createdTo }}
                    onChange={(v) => {
                      const r = typeof v === 'string' ? { from: v, to: v } : v;
                      handleFilterChange('createdFrom', r.from);
                      handleFilterChange('createdTo', r.to);
                    }}
                    onClose={() => setCreatedDateAnchor(null)}
                  />
                </Box>
              </Popover>
            </Box>
            {hasActiveFilters() && (
              <Button size="small" onClick={clearFilters} sx={{ fontFamily: T.font, fontSize: '0.75rem', textTransform: 'none', color: T.accent }}>
                Clear all
              </Button>
            )}
          </Box>
        </Box>
      )}

      {activeFilterLabels.length > 0 && !filtersVisible && (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.5 }}>
          {activeFilterLabels.map((t) => (
            <FilterToken key={t.key} label={t.label} onRemove={() => {
              handleFilterChange(t.key as keyof GroupFilters, '');
              if (t.key === 'createdFrom') handleFilterChange('createdTo', '');
            }} />
          ))}
        </Box>
      )}

      {tabValue === 1 && loadingExternal ? (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
          <CircularProgress />
        </Box>
      ) : (
      <>
      {loadError && !loading && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setLoadError(null)}>{loadError}</Alert>
      )}
      <ListShell>
        <ListHeaderRow>
          <Box sx={listCheckboxSx}>
            <Checkbox
              size="small"
              indeterminate={selectedGroups.length > 0 && selectedGroups.length < filteredGroups.length}
              checked={filteredGroups.length > 0 && selectedGroups.length === filteredGroups.length}
              onChange={handleSelectAllGroups}
              sx={{ p: 0.25 }}
            />
          </Box>
          {columns.map((col) => (
            <ColumnHeader
              key={col.id}
              label={col.label}
              columnId={col.id}
              sortConfig={sortConfig}
              onSort={handleSort}
              sortable={col.sortable !== false}
              {...cols.headerProps(col.id)}
            />
          ))}
          <ColumnHeader
            label=""
            columnId="__open"
            sortConfig={sortConfig}
            onSort={() => {}}
            width={36}
            align="right"
            sortable={false}
            pinEnd
          />
        </ListHeaderRow>

        {filteredGroups.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', fontWeight: 500, color: (t) => textSecondary(t) }}>
              {loading ? 'Loading…' : 'No groups found'}
            </Typography>
          </Box>
        ) : (
          pageRows.map((group, idx) => {
            const selected = selectedGroups.includes(group.email);
            return (
              <ListDataRow
                key={group.id}
                last={idx === pageRows.length - 1}
                selected={selected}
                onClick={() => handleOpenEditDialog(group)}
              >
                <Box sx={listCheckboxSx} onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    size="small"
                    checked={selected}
                    onChange={() => handleSelectGroup(group.email)}
                    sx={{ p: 0.25 }}
                  />
                </Box>
                <Box sx={cols.cellSx('name')}>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: (theme) => pick(theme, T.text, '#fafafa') }}>
                    {group.name}
                  </Typography>
                </Box>
                <Box sx={cols.cellSx('email')}>
                  <Typography sx={{ fontFamily: T.mono, fontSize: '0.75rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {group.email}
                  </Typography>
                </Box>
                <Box sx={cols.cellSx('description')}>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {group.description || '—'}
                  </Typography>
                </Box>
                <Box sx={cols.cellSx('directMembersCount')}>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>
                    {group.directMembersCount ?? 0}
                  </Typography>
                </Box>
                <Box sx={cols.cellSx('creationTime')}>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>
                    {formatDate(group.creationTime)}
                  </Typography>
                </Box>
                <Box sx={listActionsSx}>
                  <ListChevron />
                </Box>
              </ListDataRow>
            );
          })
        )}
      </ListShell>

      {filteredGroups.length > 0 && (
        <TablePagination
          component="div"
          count={filteredGroups.length}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[25, 50, 100]}
          sx={{
            fontFamily: T.font,
            '& .MuiTablePagination-toolbar, & .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {
              fontFamily: T.font,
              fontSize: '0.8125rem',
            },
            '& .MuiInputBase-root': { fontFamily: T.font },
          }}
          SelectProps={{
            sx: { '& .MuiSelect-select': { textAlign: 'right', fontFamily: T.font } },
            MenuProps: {
              ...selectMenuProps,
              PaperProps: {
                ...selectMenuProps.PaperProps,
                sx: {
                  ...selectMenuProps.PaperProps.sx,
                  '& .MuiMenuItem-root': { justifyContent: 'flex-end', textAlign: 'right', fontFamily: T.font },
                },
              },
            },
          }}
        />
      )}
      </>
      )}

      <Dialog open={editDialogOpen} onClose={handleCloseEditDialog} maxWidth="md" fullWidth PaperProps={{ sx: (th) => dialogPaperSx(th) }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5, borderBottom: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}` }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.02em', color: (t) => pick(t, T.text, '#fafafa') }}>{selectedGroup?.name}</Typography>
            <Typography sx={{ fontFamily: T.mono, fontSize: '0.75rem', color: (t) => textSecondary(t), mt: 0.25 }}>{selectedGroup?.email}</Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: '20px !important' }}>
          <Typography sx={{ fontFamily: T.font, fontWeight: 600, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: (t) => textTertiary(t), mb: 1.5 }}>Members</Typography>
          <Box display="flex" alignItems="center" gap={1} mb={1.5} flexWrap="wrap">
            <FlyoutSearch
              value={memberSearchTerm}
              onChange={setMemberSearchTerm}
              placeholder="Search members by email…"
              tooltip="Search members by email"
            />
            {selectedMembers.length > 0 && (
              <Button
                size="small"
                variant="contained"
                color="error"
                onClick={handleRemoveSelectedMembers}
                disabled={removingMembers}
                startIcon={removingMembers ? <CircularProgress size={14} color="inherit" /> : <Trash2 size={15} strokeWidth={1.75} />}
                sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, height: 30, px: 1.5 }}
              >
                Remove {selectedMembers.length} selected
              </Button>
            )}
          </Box>

          {loadingMembers ? (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
              <CircularProgress />
            </Box>
          ) : (
            <ListShell>
              <ListHeaderRow>
                {members.length > 0 ? (
                  <Checkbox
                    size="small"
                    indeterminate={
                      filteredMembersForDialog.length > 0 &&
                      selectedMembers.some(e => filteredMembersForDialog.some(m => m.email === e)) &&
                      !filteredMembersForDialog.every(m => selectedMembers.includes(m.email))
                    }
                    checked={
                      filteredMembersForDialog.length > 0 &&
                      filteredMembersForDialog.every(m => selectedMembers.includes(m.email))
                    }
                    onChange={() => {
                      const filteredEmails = filteredMembersForDialog.map(m => m.email);
                      const allFilteredSelected = filteredEmails.every(e => selectedMembers.includes(e));
                      if (allFilteredSelected) {
                        setSelectedMembers(prev => prev.filter(e => !filteredEmails.includes(e)));
                      } else {
                        setSelectedMembers(prev => [...new Set([...prev, ...filteredEmails])]);
                      }
                    }}
                    sx={{ p: 0.25, mr: 0.5 }}
                  />
                ) : (
                  <Box sx={{ width: 34, mr: 0.5, flexShrink: 0 }} />
                )}
                <ColumnHeader label="Email" columnId="em" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} {...memberCols.headerProps('email')} />
                <ColumnHeader label="Role" columnId="rl" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} {...memberCols.headerProps('role')} />
                <ColumnHeader label="Type" columnId="ty" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} {...memberCols.headerProps('type')} />
                <ColumnHeader label="Status" columnId="st" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} {...memberCols.headerProps('status')} />
                <ColumnHeader label="Remove" columnId="rm" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} width={72} align="right" pinEnd />
              </ListHeaderRow>
              {members.length === 0 && !addMemberInlineOpen && (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>No members in this group</Typography>
                </Box>
              )}
              {members.length > 0 && filteredMembersForDialog.length === 0 && (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>No members match &quot;{memberSearchTerm}&quot;</Typography>
                </Box>
              )}
              {pagedMembersForDialog.map((member, midx) => {
                const globalMidx = membersPageSafe * membersRowsPerPage + midx;
                return (
                <ListDataRow key={member.id} last={globalMidx === filteredMembersForDialog.length - 1 && addMemberInlineOpen}>
                  <Checkbox size="small" checked={selectedMembers.includes(member.email)} onChange={() => handleSelectMember(member.email)} sx={{ p: 0.25, mr: 0.5 }} />
                  <Box sx={memberCols.cellSx('email')}>
                    <Typography sx={{ fontFamily: T.mono, fontSize: '0.75rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.email}</Typography>
                  </Box>
                  <Box sx={memberCols.cellSx('role')}>
                    <DotLabel
                      dotColor={
                        member.role === 'OWNER' ? T.danger : member.role === 'MANAGER' ? T.warning : textTertiary(theme)
                      }
                    >
                      {member.role}
                    </DotLabel>
                  </Box>
                  <Box sx={memberCols.cellSx('type')}>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{member.type}</Typography>
                  </Box>
                  <Box sx={memberCols.cellSx('status')}>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{member.status}</Typography>
                  </Box>
                  <Box sx={{ width: 72, flex: '0 0 72px', ml: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
                    <ActionTooltip title="Remove member">
                      <IconButton size="small" color="error" onClick={() => handleRemoveMember(member.email)} sx={{ p: 0.5 }}>
                        <Trash2 size={16} strokeWidth={1.75} />
                      </IconButton>
                    </ActionTooltip>
                  </Box>
                </ListDataRow>
              );
              })}
              <DialogListPagination
                page={membersPageSafe}
                rowsPerPage={membersRowsPerPage}
                total={filteredMembersForDialog.length}
                onPageChange={setMembersDialogPage}
                onRowsPerPageChange={(n) => {
                  setMembersRowsPerPage(n);
                  setMembersDialogPage(0);
                }}
              />
              {addMemberInlineOpen ? (
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
                  <Box sx={{ ...memberCols.cellSx('email'), overflow: 'visible' }}>
                    <Autocomplete
                      freeSolo
                      options={directorySuggestions}
                      value={addMemberEmail}
                      inputValue={addMemberEmail}
                      onInputChange={(_, value) => setAddMemberEmail(value)}
                      onChange={(_, value) => setAddMemberEmail(typeof value === 'string' ? value : '')}
                      loading={loadingUsers}
                      filterOptions={(options, { inputValue }) => {
                        if (!inputValue.trim()) return options;
                        const search = inputValue.toLowerCase().trim();
                        return options.filter((option) => option.toLowerCase().includes(search));
                      }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          autoFocus
                          size="small"
                          placeholder="Type name/email (e.g. joe)"
                          sx={{ fontFamily: T.font, '& .MuiOutlinedInput-root': { fontSize: '0.8125rem' }, '& .MuiInputBase-input': { py: 0.5 } }}
                        />
                      )}
                      fullWidth
                    />
                  </Box>
                  <Box sx={memberCols.cellSx('role')}>
                    <FormControl size="small" fullWidth sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.8125rem', '& .MuiSelect-select': { py: 0.5 } } }}>
                      <Select value={addMemberRole} onChange={(e) => setAddMemberRole(e.target.value as 'MEMBER' | 'MANAGER' | 'OWNER')}>
                        <MenuItem value="MEMBER">Member</MenuItem>
                        <MenuItem value="MANAGER">Manager</MenuItem>
                        <MenuItem value="OWNER">Owner</MenuItem>
                      </Select>
                    </FormControl>
                  </Box>
                  <Box sx={memberCols.cellSx('type')}>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>—</Typography>
                  </Box>
                  <Box sx={memberCols.cellSx('status')}>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>—</Typography>
                  </Box>
                  <Box sx={{ width: 72, flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                    <Tooltip title="Cancel">
                      <IconButton size="small" onClick={() => { setAddMemberInlineOpen(false); setAddMemberEmail(''); setAddMemberRole('MEMBER'); }} aria-label="Cancel">
                        <X size={18} strokeWidth={1.75} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Add">
                      <IconButton size="small" color="primary" onClick={handleAddMember} disabled={!normalizeEmailInput(addMemberEmail) || addingMember} aria-label="Add">
                        <Check size={18} strokeWidth={1.75} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
              ) : (
                <Box sx={(t) => ({ px: 2, py: 1, borderTop: members.length > 0 ? `1px solid ${pick(t, T.borderSubtle, '#27272a')}` : 'none' })}>
                  <Button
                    size="small"
                    variant="text"
                    color="primary"
                    onClick={() => setAddMemberInlineOpen(true)}
                    startIcon={<Plus size={15} strokeWidth={1.75} />}
                    sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 600 }}
                  >
                    Add member
                  </Button>
                </Box>
              )}
            </ListShell>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, borderTop: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}`, gap: 1 }}>
          <Button onClick={handleCloseEditDialog} sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, color: (t) => textSecondary(t), '&:hover': { bgcolor: (t) => pick(t, '#f0f0ec', '#27272a') } }}>
            Done
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={addUserDialogOpen} onClose={handleCloseAddUserDialog} maxWidth="md" fullWidth PaperProps={{ sx: (th) => dialogPaperSx(th) }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5, borderBottom: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}` }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.02em', color: (t) => pick(t, T.text, '#fafafa') }}>Add user to groups</Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: '20px !important' }}>
          <Box mb={2}>
            <Autocomplete
              options={users}
              getOptionLabel={(option) => {
                if (typeof option === 'string') return option;
                return `${option.name.fullName} (${option.primaryEmail})`;
              }}
              value={selectedUser}
              open={autocompleteOpen}
              onOpen={() => {
                // Only open if there's input text
                if (userEmailToAdd.trim().length > 0) {
                  setAutocompleteOpen(true);
                }
              }}
              onClose={() => setAutocompleteOpen(false)}
              onChange={(_event, newValue) => {
                if (newValue && typeof newValue === 'object' && 'primaryEmail' in newValue) {
                  setSelectedUser(newValue);
                  setUserEmailToAdd(newValue.primaryEmail);
                  setAutocompleteOpen(false);
                } else if (typeof newValue === 'string') {
                  // Free text input - user typed a custom email
                  setSelectedUser(null);
                  setUserEmailToAdd(newValue);
                } else {
                  setSelectedUser(null);
                  setUserEmailToAdd('');
                }
              }}
              onInputChange={(_event, newInputValue, reason) => {
                // Update email when user types, but only if not selecting from dropdown
                if (reason === 'input' || reason === 'clear') {
                  if (!selectedUser || newInputValue !== selectedUser.primaryEmail) {
                    setUserEmailToAdd(newInputValue);
                    if (reason === 'clear') {
                      setSelectedUser(null);
                      setAutocompleteOpen(false);
                    } else if (newInputValue.trim().length > 0) {
                      // Open dropdown when user starts typing
                      setAutocompleteOpen(true);
                    } else {
                      // Close dropdown when input is empty
                      setAutocompleteOpen(false);
                    }
                  }
                }
              }}
              filterOptions={(options, params) => {
                if (!params.inputValue) {
                  return [];
                }
                
                const searchLower = params.inputValue.toLowerCase();
                const filtered = options.filter((option) => {
                  return (
                    option.primaryEmail.toLowerCase().includes(searchLower) ||
                    option.name.fullName.toLowerCase().includes(searchLower) ||
                    (option.name.givenName ?? '').toLowerCase().includes(searchLower) ||
                    (option.name.familyName ?? '').toLowerCase().includes(searchLower)
                  );
                });

                return filtered;
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  autoFocus
                  label="User Email or Name"
                  placeholder="Search by name or email, or type an email address"
                  helperText="Search for a user or enter an email address"
                  required
                />
              )}
              renderOption={(props, option) => (
                <Box component="li" {...props} key={option.id}>
                  <Box>
                    <Typography variant="body1">{option.name.fullName}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {option.primaryEmail}
                    </Typography>
                  </Box>
                </Box>
              )}
              loading={loadingUsers}
              freeSolo
              fullWidth
              openOnFocus={false}
            />
          </Box>

          <Box mb={2}>
            <FormControl fullWidth>
              <InputLabel>Role</InputLabel>
              <Select
                value={userRole}
                label="Role"
                onChange={(e) => setUserRole(e.target.value as 'OWNER' | 'MANAGER' | 'MEMBER')}
              >
                <MenuItem value="MEMBER">Member</MenuItem>
                <MenuItem value="MANAGER">Manager</MenuItem>
                <MenuItem value="OWNER">Owner</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Divider sx={{ my: 2 }} />

          <Typography sx={{ fontFamily: T.font, fontWeight: 600, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: (t) => textTertiary(t), mb: 1 }}>
            Select groups ({selectedGroupsForUser.length} of {groups.length} selected)
          </Typography>

          {groups.length === 0 ? (
            <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t), py: 4, textAlign: 'center' }}>
              No groups available
            </Typography>
          ) : (
            <Box>
              <ListShell>
                <ListHeaderRow>
                  <Checkbox
                    size="small"
                    indeterminate={selectedGroupsForUser.length > 0 && selectedGroupsForUser.length < groups.length}
                    checked={groups.length > 0 && selectedGroupsForUser.length === groups.length}
                    onChange={handleSelectAllGroupsForUser}
                    sx={{ p: 0.25, mr: 0.5 }}
                  />
                  <ColumnHeader label="Name" columnId="gn" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} {...pickerCols.headerProps('name')} />
                  <ColumnHeader label="Email" columnId="ge" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} {...pickerCols.headerProps('email')} />
                  <ColumnHeader label="Description" columnId="gd" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} {...pickerCols.headerProps('description')} />
                  <ColumnHeader label="Members" columnId="gm" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} {...pickerCols.headerProps('members')} />
                </ListHeaderRow>
                {pagedGroupsForPicker.map((group, gidx) => {
                  const globalGidx = agPageSafe * addUserGroupsRowsPerPage + gidx;
                  return (
                  <ListDataRow key={group.id} last={globalGidx === groups.length - 1} selected={selectedGroupsForUser.includes(group.email)}>
                    <Checkbox size="small" checked={selectedGroupsForUser.includes(group.email)} onChange={() => handleSelectGroupForUser(group.email)} sx={{ p: 0.25, mr: 0.5 }} />
                    <Box sx={pickerCols.cellSx('name')}>
                      <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, color: (t) => pick(t, T.text, '#fafafa'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.name}</Typography>
                    </Box>
                    <Box sx={pickerCols.cellSx('email')}>
                      <Typography sx={{ fontFamily: T.mono, fontSize: '0.75rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.email}</Typography>
                    </Box>
                    <Box sx={pickerCols.cellSx('description')}>
                      <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.description || '—'}</Typography>
                    </Box>
                    <Box sx={pickerCols.cellSx('members')}>
                      <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{group.directMembersCount ?? 0}</Typography>
                    </Box>
                  </ListDataRow>
                );
                })}
                <DialogListPagination
                  page={agPageSafe}
                  rowsPerPage={addUserGroupsRowsPerPage}
                  total={groups.length}
                  onPageChange={setAddUserGroupsPage}
                  onRowsPerPageChange={(n) => {
                    setAddUserGroupsRowsPerPage(n);
                    setAddUserGroupsPage(0);
                  }}
                />
              </ListShell>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, borderTop: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}`, gap: 1 }}>
          <Button onClick={handleCloseAddUserDialog} sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, color: (t) => textSecondary(t), '&:hover': { bgcolor: (t) => pick(t, '#f0f0ec', '#27272a') } }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleAddUserToGroups}
            disabled={(!selectedUser && !userEmailToAdd.trim()) || selectedGroupsForUser.length === 0 || addingUser}
            sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, bgcolor: T.accent, '&:hover': { bgcolor: T.accentHover }, px: 2.5 }}
          >
            {addingUser ? 'Adding...' : `Add to ${selectedGroupsForUser.length} group${selectedGroupsForUser.length === 1 ? '' : 's'}`}
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
      {confirmDialog}
    </Box>
  );
}
