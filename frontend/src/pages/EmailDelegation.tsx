import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  Box,
  TextField,
  Autocomplete,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TablePagination,
  Checkbox,
  IconButton,
  Button,
  Typography,
  FormControl,
  Select,
  MenuItem,
  useMediaQuery,
  InputAdornment,
  Snackbar,
  Alert,
} from '@mui/material';
import type { AlertColor } from '@mui/material';
import { Plus, Search, Trash2, RefreshCw, ListFilter, X } from 'lucide-react';
import { apiClient } from '../services/api.client';
import { useTable, TableColumn } from '../hooks/useTable.tsx';
import { ExportButton } from '../components/ExportButton';
import { ActionTooltip } from '../components/ActionTooltip';
import { FilterToken } from '../components/ui/FilterToken';
import { T, pick, textSecondary, textTertiary, exportToolbarButtonSx, selectMenuProps } from '../theme/designTokens';
import { tablePaginationProps } from '../components/ui/tablePaginationProps';
import { ColumnHeader } from '../components/ui/ColumnHeader';
import { ListShell, ListHeaderRow, ListDataRow } from '../components/ui/ListShell';
import { useTheme } from '@mui/material/styles';
import { DotLabel } from '../components/StatusDot';
import { useConfirm } from '../hooks/useConfirm';
import { getApiErrorMessage } from '../utils/apiError';

interface AllDelegation {
  userEmail: string;
  delegateEmail: string;
  verificationStatus: string;
}

interface DelegationCoverage {
  usersTotal: number;
  usersOk: number;
  usersFailed: number;
  usersSkippedSuspended: number;
  failures: Array<{ email: string; error: string }>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmailInput(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (EMAIL_RE.test(trimmed)) return trimmed;
  const inParens = trimmed.match(/\(([^\s@]+@[^\s@]+\.[^\s@]+)\)\s*$/)?.[1];
  return inParens || '';
}

function delegationKey(d: AllDelegation) {
  return `${d.userEmail}|${d.delegateEmail}`;
}

export function EmailDelegation() {
  const muiTheme = useTheme();
  const isMdUp = useMediaQuery(muiTheme.breakpoints.up('md'));
  const dialogPaperSx = {
    fontFamily: T.font,
    bgcolor: pick(muiTheme, T.surface, '#18181b'),
    backgroundImage: 'none',
    border: `1px solid ${pick(muiTheme, T.border, '#3f3f46')}`,
    borderRadius: T.radiusLg,
    '& .MuiDialogContent-root': { pt: 0 },
    '& .MuiTypography-root, & .MuiInputBase-root, & .MuiFormLabel-root': { fontFamily: T.font },
    '& .MuiOutlinedInput-notchedOutline': { borderColor: pick(muiTheme, T.border, '#3f3f46') },
  };
  const { confirm, confirmDialog } = useConfirm();
  const [allDelegations, setAllDelegations] = useState<AllDelegation[]>([]);
  const [coverage, setCoverage] = useState<DelegationCoverage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newDelegateEmail, setNewDelegateEmail] = useState('');
  const [directorySuggestions, setDirectorySuggestions] = useState<string[]>([]);
  const [loadingDirectoryUsers, setLoadingDirectoryUsers] = useState(false);
  const [selectedDelegations, setSelectedDelegations] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  const [filtersVisible, setFiltersVisible] = useState(false);

  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: AlertColor }>({
    open: false, message: '', severity: 'info',
  });
  const showSnackbar = useCallback((message: string, severity: AlertColor = 'info') => {
    setSnackbar({ open: true, message, severity });
  }, []);
  const closeSnackbar = useCallback(() => setSnackbar((s) => ({ ...s, open: false })), []);

  type DelegationFiltersType = { userEmail: string; delegateEmail: string; verificationStatus: string };
  const [filters, setFilters] = useState<DelegationFiltersType>({
    userEmail: '',
    delegateEmail: '',
    verificationStatus: '',
  });

  const exportAllCSVRef = useRef<() => void>(() => {});
  const exportSelectedCSVRef = useRef<() => void>(() => {});
  const normalizedNewUserEmail = useMemo(() => normalizeEmailInput(newUserEmail), [newUserEmail]);
  const normalizedNewDelegateEmail = useMemo(() => normalizeEmailInput(newDelegateEmail), [newDelegateEmail]);

  const handleFilterChange = (key: keyof DelegationFiltersType, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };
  const hasActiveFilters = () => Object.values(filters).some((v) => v.trim() !== '');
  const clearFilters = () => {
    setFilters({ userEmail: '', delegateEmail: '', verificationStatus: '' });
  };

  const activeFilterLabels = useMemo(() => {
    const labels: { key: string; label: string }[] = [];
    if (filters.userEmail.trim()) labels.push({ key: 'userEmail', label: `User: ${filters.userEmail}` });
    if (filters.delegateEmail.trim()) labels.push({ key: 'delegateEmail', label: `Delegate: ${filters.delegateEmail}` });
    if (filters.verificationStatus) labels.push({ key: 'verificationStatus', label: `Status: ${filters.verificationStatus}` });
    return labels;
  }, [filters]);

  const filteredByColumnFilters = useMemo(() => {
    return allDelegations.filter((d) => {
      if (filters.userEmail.trim() && !d.userEmail.toLowerCase().includes(filters.userEmail.toLowerCase())) return false;
      if (filters.delegateEmail.trim() && !d.delegateEmail.toLowerCase().includes(filters.delegateEmail.toLowerCase())) return false;
      if (filters.verificationStatus.trim() && d.verificationStatus !== filters.verificationStatus) return false;
      return true;
    });
  }, [allDelegations, filters]);

  const allDelegationsColumns: TableColumn<AllDelegation>[] = [
    {
      id: 'userEmail',
      label: 'User Email',
      sortable: true,
      getValue: (row) => row.userEmail,
    },
    {
      id: 'delegateEmail',
      label: 'Delegate Email',
      sortable: true,
      getValue: (row) => row.delegateEmail,
    },
    {
      id: 'verificationStatus',
      label: 'Verification Status',
      sortable: true,
      getValue: (row) => row.verificationStatus,
    },
  ];

  const allDelegationsTable = useTable(filteredByColumnFilters, allDelegationsColumns, 'userEmail');
  const { sortConfig, handleSort } = allDelegationsTable;

  useEffect(() => {
    fetchAllDelegations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dialogOpen || directorySuggestions.length > 0 || loadingDirectoryUsers) return;
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
        const uniqueSorted = Array.from(uniqueByEmail.values()).sort((a, b) => a.localeCompare(b));
        setDirectorySuggestions(uniqueSorted);
      } catch (error) {
        console.error('Error fetching users for delegation suggestions:', error);
        setDirectorySuggestions([]);
      } finally {
        setLoadingDirectoryUsers(false);
      }
    };
    void fetchDirectoryUsers();
  }, [dialogOpen, directorySuggestions.length, loadingDirectoryUsers]);

  const fetchAllDelegations = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/gmail/delegations');
      const payload = response.data;
      if (Array.isArray(payload)) {
        setAllDelegations(payload);
        setCoverage(null);
      } else if (payload && Array.isArray(payload.delegations)) {
        setAllDelegations(payload.delegations);
        setCoverage(payload.coverage && typeof payload.coverage === 'object' ? payload.coverage : null);
      } else {
        setAllDelegations([]);
        setCoverage(null);
      }
      setLoadError(null);
    } catch (error: any) {
      console.error('Error fetching all delegations:', error);
      setAllDelegations([]);
      setCoverage(null);
      setLoadError(getApiErrorMessage(error, 'Failed to load delegations'));
      showSnackbar(getApiErrorMessage(error, 'Failed to load delegations.'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddDelegation = async () => {
    if (!normalizedNewUserEmail || !normalizedNewDelegateEmail) return;
    if (!EMAIL_RE.test(normalizedNewUserEmail) || !EMAIL_RE.test(normalizedNewDelegateEmail)) {
      showSnackbar('Enter valid user and delegate email addresses.', 'error');
      return;
    }
    if (normalizedNewUserEmail.toLowerCase() === normalizedNewDelegateEmail.toLowerCase()) {
      showSnackbar('Cannot delegate a mailbox to itself. Choose a different delegate.', 'error');
      return;
    }
    try {
      await apiClient.post(`/gmail/${encodeURIComponent(normalizedNewUserEmail)}/delegations`, {
        delegateEmail: normalizedNewDelegateEmail,
      });
      setNewUserEmail('');
      setNewDelegateEmail('');
      setDialogOpen(false);
      fetchAllDelegations();
    } catch (error: any) {
      console.error('Error adding delegation:', error);
      const backendMessage = error?.response?.data?.error as string | undefined;
      if (backendMessage) {
        showSnackbar(backendMessage, 'error');
      } else if (error?.response?.status === 403) {
        showSnackbar('Delegation was denied by Google Workspace. Confirm super admin access and Gmail delegation scopes.', 'error');
      } else {
        showSnackbar('Failed to add delegation.', 'error');
      }
    }
  };

  const data = allDelegationsTable.data;
  const isSelected = (d: AllDelegation) => selectedDelegations.has(delegationKey(d));
  const handleSelectOne = (d: AllDelegation) => {
    const key = delegationKey(d);
    setSelectedDelegations((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const handleSelectAll = () => {
    if (selectedDelegations.size === data.length) {
      setSelectedDelegations(new Set());
    } else {
      setSelectedDelegations(new Set(data.map(delegationKey)));
    }
  };
  const handleRemoveSelected = async () => {
    if (selectedDelegations.size === 0) return;
    if (!(await confirm({
      title: 'Remove delegations?',
      message: `Remove ${selectedDelegations.size} delegation(s)? This cannot be undone.`,
      danger: true,
      confirmLabel: 'Remove',
    }))) return;
    setRemoving(true);
    try {
      for (const key of selectedDelegations) {
        const [userEmail, delegateEmail] = key.split('|');
        await apiClient.delete(`/gmail/${encodeURIComponent(userEmail)}/delegations/${encodeURIComponent(delegateEmail)}`);
      }
      setSelectedDelegations(new Set());
      fetchAllDelegations();
    } catch (err: any) {
      console.error(err);
      showSnackbar(getApiErrorMessage(err, 'Failed to remove one or more delegations.'), 'error');
    } finally {
      setRemoving(false);
    }
  };
  const handleRemoveOne = async (d: AllDelegation) => {
    if (!(await confirm({
      title: 'Remove delegation?',
      message: `Remove delegation for ${d.delegateEmail} from ${d.userEmail}? This cannot be undone.`,
      danger: true,
      confirmLabel: 'Remove',
    }))) return;
    try {
      await apiClient.delete(`/gmail/${encodeURIComponent(d.userEmail)}/delegations/${encodeURIComponent(d.delegateEmail)}`);
      fetchAllDelegations();
      setSelectedDelegations((prev) => {
        const next = new Set(prev);
        next.delete(delegationKey(d));
        return next;
      });
    } catch (err: any) {
      console.error(err);
      showSnackbar(getApiErrorMessage(err, 'Failed to remove delegation.'), 'error');
    }
  };

  const handleExportAllCSV = () => { allDelegationsTable.exportToCSV(`AllDelegations${allDelegationsTable.searchTerm || hasActiveFilters() ? '_filtered' : ''}_${new Date().toISOString().split('T')[0]}.csv`); showSnackbar('CSV downloading now.', 'success'); };
  const handleExportSelectedCSV = () => {
    const selected = allDelegations.filter((d) => selectedDelegations.has(delegationKey(d)));
    if (selected.length === 0) return;
    const headers = ['User Email', 'Delegate Email', 'Verification Status'];
    const rows = selected.map((d) => [d.userEmail, d.delegateEmail, d.verificationStatus].map((c) => (String(c).includes(',') ? `"${String(c).replace(/"/g, '""')}"` : c)).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Delegations_selected_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
    showSnackbar('CSV downloading now.', 'success');
  };
  const handleExportFilteredCSV = () => { allDelegationsTable.exportToCSV(`AllDelegations_filtered_${new Date().toISOString().split('T')[0]}.csv`); showSnackbar('CSV downloading now.', 'success'); };
  const handleExportAllDrive = async () => {
    try {
      const response = await apiClient.post('/gmail/delegations/export/drive');
      const msg = response.data?.message || 'Delegations exported to Drive.';
      if (response.data?.webViewLink) window.open(response.data.webViewLink, '_blank');
      showSnackbar(msg, 'success');
    } catch (err: any) {
      console.error(err);
      showSnackbar(getApiErrorMessage(err, 'Failed to export delegations to Drive.'), 'error');
    }
  };
  const handleExportSelectedDrive = async () => {
    const selected = allDelegations.filter((d) => selectedDelegations.has(delegationKey(d)));
    if (selected.length === 0) return;
    try {
      const response = await apiClient.post('/gmail/delegations/export/selected/drive', {
        delegations: selected.map((d) => ({ userEmail: d.userEmail, delegateEmail: d.delegateEmail })),
      });
      const msg = response.data?.message || 'Selected delegations exported to Drive.';
      if (response.data?.webViewLink) window.open(response.data.webViewLink, '_blank');
      showSnackbar(msg, 'success');
    } catch (err: any) {
      console.error(err);
      showSnackbar(getApiErrorMessage(err, 'Failed to export selected delegations to Drive.'), 'error');
    }
  };
  const handleExportFilteredDrive = async () => {
    try {
      const response = await apiClient.post('/gmail/delegations/export/drive');
      const msg = response.data?.message || 'Delegations exported to Drive.';
      if (response.data?.webViewLink) window.open(response.data.webViewLink, '_blank');
      showSnackbar(msg, 'success');
    } catch (err: any) {
      console.error(err);
      showSnackbar(getApiErrorMessage(err, 'Failed to export delegations to Drive.'), 'error');
    }
  };

  exportAllCSVRef.current = handleExportAllCSV;
  exportSelectedCSVRef.current = handleExportSelectedCSV;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
      }
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setFiltersVisible((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        e.stopPropagation();
        const fn = selectedDelegations.size > 0 ? exportSelectedCSVRef.current : exportAllCSVRef.current;
        if (typeof fn === 'function') fn();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
        e.preventDefault();
        if (selectedDelegations.size > 0) handleExportSelectedDrive();
        else if (Boolean(allDelegationsTable.searchTerm) || hasActiveFilters()) handleExportFilteredDrive();
        else handleExportAllDrive();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [selectedDelegations.size]);

  return (
    <Box sx={{ fontFamily: T.font, minHeight: '100vh' }}>
      <Box sx={{ mb: 3 }}>
        <Typography sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.02em', color: (theme) => pick(theme, T.text, '#fafafa') }}>
          Email delegation
        </Typography>
        <Typography sx={{ fontFamily: T.font, fontSize: '0.875rem', color: (theme) => textSecondary(theme), mt: 0.5 }}>
          Mailbox owner → delegate (any direction, including when you are either party)
        </Typography>
      </Box>

      {loadError && (
        <Alert severity="error" sx={{ mb: 2, fontFamily: T.font, borderRadius: T.radius }} onClose={() => setLoadError(null)}>
          {loadError}
        </Alert>
      )}

      {coverage && coverage.usersFailed > 0 && (
        <Alert severity="warning" sx={{ mb: 2, fontFamily: T.font, borderRadius: T.radius }}>
          Partial scan: checked {coverage.usersOk} of {coverage.usersTotal} mailboxes
          {coverage.usersSkippedSuspended > 0 ? ` (${coverage.usersSkippedSuspended} suspended skipped)` : ''}.
          {' '}{coverage.usersFailed} mailbox{coverage.usersFailed === 1 ? '' : 'es'} could not be read
          (often no Gmail license or API delay). The table may be incomplete.
          {coverage.failures.length > 0 && (
            <Box component="span" sx={{ display: 'block', mt: 0.75, fontSize: '0.8125rem', opacity: 0.9 }}>
              Examples: {coverage.failures.slice(0, 3).map((f) => f.email).join(', ')}
              {coverage.failures.length > 3 ? '…' : ''}
            </Box>
          )}
        </Alert>
      )}

      {coverage && coverage.usersFailed === 0 && coverage.usersTotal > 0 && !loading && (
        <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (theme) => textTertiary(theme), mb: 1.5 }}>
          Scanned {coverage.usersOk} mailbox{coverage.usersOk === 1 ? '' : 'es'}
          {coverage.usersSkippedSuspended > 0 ? ` (${coverage.usersSkippedSuspended} suspended skipped)` : ''}.
        </Typography>
      )}

      {/* Toolbar */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Search delegations…"
          value={allDelegationsTable.searchTerm}
          onChange={(e) => allDelegationsTable.setSearchTerm(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Box component="span" sx={{ display: 'flex', color: (t: any) => textTertiary(t) }}>
                  <Search size={18} strokeWidth={1.75} />
                </Box>
              </InputAdornment>
            ),
            ...(allDelegationsTable.searchTerm ? { endAdornment: (
              <InputAdornment position="end">
                <Box component="span" onClick={() => allDelegationsTable.setSearchTerm('')} sx={{ display: 'flex', cursor: 'pointer', color: (t: any) => textTertiary(t) }}>
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

        <ActionTooltip title="Refresh data">
          <span>
            <IconButton size="small" onClick={fetchAllDelegations} disabled={loading} aria-label="Refresh data" sx={{ color: (t) => textSecondary(t) }}>
              {loading ? <CircularProgress size={20} /> : <RefreshCw size={18} strokeWidth={1.75} />}
            </IconButton>
          </span>
        </ActionTooltip>

        <Box sx={{ flex: 1 }} />

        {selectedDelegations.size > 0 && (
          <Button
            size="small"
            variant="contained"
            color="error"
            onClick={handleRemoveSelected}
            disabled={removing}
            startIcon={removing ? <CircularProgress size={14} color="inherit" /> : <Trash2 size={15} strokeWidth={1.75} />}
            sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, height: 30, px: 1.5 }}
          >
            Remove {selectedDelegations.size} selected
          </Button>
        )}

        <Button
          size="small"
          variant="contained"
          onClick={() => setDialogOpen(true)}
          data-testid="add-delegation"
          startIcon={<Plus size={15} strokeWidth={1.75} />}
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
          Add delegation
        </Button>

        <ExportButton
          iconOnly={!isMdUp}
          tooltipTitle="Export"
          totalItems={allDelegationsTable.totalRows}
          selectedCount={selectedDelegations.size}
          hasFilters={Boolean(allDelegationsTable.searchTerm) || hasActiveFilters()}
          onExportAllCSV={handleExportAllCSV}
          onExportSelectedCSV={handleExportSelectedCSV}
          onExportFilteredCSV={handleExportFilteredCSV}
          onExportAllDrive={handleExportAllDrive}
          onExportSelectedDrive={handleExportSelectedDrive}
          onExportFilteredDrive={handleExportFilteredDrive}
          disabled={allDelegationsTable.data.length === 0}
          triggerSx={exportToolbarButtonSx()}
        />
      </Box>

      {/* Filter panel (collapsible) */}
      <Box sx={{ overflow: 'hidden', maxHeight: filtersVisible ? 320 : 0, opacity: filtersVisible ? 1 : 0, transition: 'max-height 0.3s ease, opacity 0.2s ease, margin 0.3s ease', mb: filtersVisible ? 2 : 0 }}>
        <Box sx={(theme: any) => ({
          display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center',
          p: 1.5, borderRadius: T.radius, border: `1px solid ${pick(theme, T.border, '#3f3f46')}`, bgcolor: pick(theme, T.surface, '#27272a'),
        })}>
          <TextField
            size="small"
            placeholder="User email…"
            value={filters.userEmail}
            onChange={(e) => handleFilterChange('userEmail', e.target.value)}
            sx={{ minWidth: 160, '& .MuiOutlinedInput-root': { fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm } }}
          />
          <TextField
            size="small"
            placeholder="Delegate email…"
            value={filters.delegateEmail}
            onChange={(e) => handleFilterChange('delegateEmail', e.target.value)}
            sx={{ minWidth: 160, '& .MuiOutlinedInput-root': { fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm } }}
          />
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <Select
              value={filters.verificationStatus}
              displayEmpty
              renderValue={(v) => (v ? (v === 'accepted' ? 'Accepted' : v === 'pending' ? 'Pending' : 'Rejected') : 'Status')}
              onChange={(e) => handleFilterChange('verificationStatus', e.target.value)}
              MenuProps={selectMenuProps}
              sx={{ fontFamily: T.font, fontSize: '0.8125rem', borderRadius: T.radiusSm }}
            >
              <MenuItem value="">Any</MenuItem>
              <MenuItem value="accepted">Accepted</MenuItem>
              <MenuItem value="pending">Pending</MenuItem>
              <MenuItem value="rejected">Rejected</MenuItem>
            </Select>
          </FormControl>
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
            <FilterToken key={t.key} label={t.label} onRemove={() => handleFilterChange(t.key as keyof DelegationFiltersType, '')} />
          ))}
        </Box>
      )}

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      ) : (
        <>

          <ListShell>
            <ListHeaderRow>
              <Checkbox
                size="small"
                indeterminate={selectedDelegations.size > 0 && selectedDelegations.size < data.length}
                checked={data.length > 0 && selectedDelegations.size === data.length}
                onChange={handleSelectAll}
                sx={{ p: 0.25, mr: 0.5 }}
              />
              <ColumnHeader label="Mailbox owner" columnId="userEmail" sortConfig={sortConfig} onSort={handleSort} width="32%" minWidth={170} />
              <ColumnHeader label="Delegate" columnId="delegateEmail" sortConfig={sortConfig} onSort={handleSort} width="32%" minWidth={170} />
              <ColumnHeader label="Status" columnId="verificationStatus" sortConfig={sortConfig} onSort={handleSort} width={120} />
              <ColumnHeader label="Actions" columnId="__a" sortConfig={sortConfig} onSort={() => {}} sortable={false} width={88} align="right" />
            </ListHeaderRow>
            {data.length === 0 ? (
              <Box sx={{ py: 6, textAlign: 'center' }}>
                <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>No delegations found</Typography>
              </Box>
            ) : (
              data.map((delegation, index) => (
                <ListDataRow key={`${delegation.userEmail}-${delegation.delegateEmail}-${index}`} last={index === data.length - 1} selected={isSelected(delegation)}>
                  <Checkbox size="small" checked={isSelected(delegation)} onChange={() => handleSelectOne(delegation)} sx={{ p: 0.25, mr: 0.5 }} />
                  <Box sx={{ width: '32%', minWidth: 170, overflow: 'hidden' }}>
                    <Typography sx={{ fontFamily: T.mono, fontSize: '0.75rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {delegation.userEmail}
                    </Typography>
                  </Box>
                  <Box sx={{ width: '32%', minWidth: 170, overflow: 'hidden' }}>
                    <Typography sx={{ fontFamily: T.mono, fontSize: '0.75rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {delegation.delegateEmail}
                    </Typography>
                  </Box>
                  <Box sx={{ width: 120, flexShrink: 0 }}>
                    <DotLabel dotColor={delegation.verificationStatus === 'accepted' ? T.success : T.warning}>
                      {delegation.verificationStatus}
                    </DotLabel>
                  </Box>
                  <Box sx={{ width: 88, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
                    <ActionTooltip title="Remove delegation">
                      <IconButton size="small" onClick={() => handleRemoveOne(delegation)} sx={{ p: 0.5, color: T.danger }}>
                        <Trash2 size={16} strokeWidth={1.75} />
                      </IconButton>
                    </ActionTooltip>
                  </Box>
                </ListDataRow>
              ))
            )}
          </ListShell>

          {allDelegationsTable.totalRows > 0 && (
            <TablePagination
              component="div"
              count={allDelegationsTable.totalRows}
              page={allDelegationsTable.page}
              onPageChange={(_, newPage) => allDelegationsTable.setPage(newPage)}
              rowsPerPage={allDelegationsTable.rowsPerPage}
              onRowsPerPageChange={(e) => {
                allDelegationsTable.setRowsPerPage(parseInt(e.target.value, 10));
                allDelegationsTable.setPage(0);
              }}
              rowsPerPageOptions={[25, 50, 100]}
              {...tablePaginationProps(muiTheme)}
            />
          )}
        </>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setNewUserEmail(''); setNewDelegateEmail(''); }}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: dialogPaperSx }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1.5, borderBottom: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}` }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.02em', color: (t) => pick(t, T.text, '#fafafa') }}>
              Add email delegation
            </Typography>
            <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), mt: 0.5 }}>
              Grants the delegate access to the mailbox owner’s inbox (same as Admin Console).
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: '20px !important' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Autocomplete
              freeSolo
              options={directorySuggestions}
              value={newUserEmail}
              inputValue={newUserEmail}
              onInputChange={(_, value) => setNewUserEmail(value)}
              onChange={(_, value) => setNewUserEmail(typeof value === 'string' ? value : '')}
              loading={loadingDirectoryUsers}
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  label="Mailbox owner"
                  placeholder="Whose mailbox? (e.g. exec@company.com)"
                  fullWidth
                  helperText={
                    loadingDirectoryUsers
                      ? 'Loading directory…'
                      : 'The account that owns the mailbox (source).'
                  }
                />
              )}
            />
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 0.25 }}>
              <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', fontWeight: 600, color: (t) => textTertiary(t), letterSpacing: '0.04em' }}>
                ↓ DELEGATE ACCESSES THIS MAILBOX
              </Typography>
            </Box>
            <Autocomplete
              freeSolo
              options={directorySuggestions}
              value={newDelegateEmail}
              inputValue={newDelegateEmail}
              onInputChange={(_, value) => setNewDelegateEmail(value)}
              onChange={(_, value) => setNewDelegateEmail(typeof value === 'string' ? value : '')}
              loading={loadingDirectoryUsers}
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  label="Delegate"
                  placeholder="Who gets access? (e.g. assistant@company.com)"
                  fullWidth
                  helperText="The person who can read and send as the owner."
                />
              )}
            />
            {normalizedNewUserEmail && normalizedNewDelegateEmail && (
              <Alert severity="info" sx={{ fontFamily: T.font, borderRadius: T.radius, py: 0.5 }}>
                <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem' }}>
                  <Box component="span" sx={{ fontWeight: 600 }}>{normalizedNewDelegateEmail}</Box>
                  {' '}will access the mailbox of{' '}
                  <Box component="span" sx={{ fontWeight: 600 }}>{normalizedNewUserEmail}</Box>
                </Typography>
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, borderTop: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}`, gap: 1 }}>
          <Button onClick={() => { setDialogOpen(false); setNewUserEmail(''); setNewDelegateEmail(''); }} sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, color: (t) => textSecondary(t), '&:hover': { bgcolor: (t) => pick(t, '#f0f0ec', '#27272a') } }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleAddDelegation}
            disabled={!normalizedNewUserEmail || !normalizedNewDelegateEmail}
            sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, bgcolor: T.accent, '&:hover': { bgcolor: T.accentHover }, px: 2.5 }}
          >
            Add Delegation
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={closeSnackbar} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={closeSnackbar} severity={snackbar.severity} sx={{ width: '100%', fontFamily: T.font, borderRadius: T.radius, alignItems: 'center' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
      {confirmDialog}
    </Box>
  );
}
