import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  CircularProgress,
  IconButton,
  Grid,
  Select,
  MenuItem,
  FormControl,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  Tooltip,
} from '@mui/material';
import type { AlertColor } from '@mui/material';
import { Trash2, ExternalLink, X } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { apiClient } from '../services/api.client';
import { ConfirmDialog } from './ConfirmDialog';
import { ActionTooltip } from './ActionTooltip';
import {
  T,
  pick,
  selectMenuProps,
  textSecondary,
  textTertiary,
  dialogPaperSx,
  dialogActionsSx,
  dialogCancelButtonSx,
  dialogPrimaryButtonSx,
  dialogSecondaryButtonSx,
} from '../theme/designTokens';
import { ColumnHeader } from './ui/ColumnHeader';
import { ListShell, ListHeaderRow, ListDataRow } from './ui/ListShell';
import { DialogListPagination, DIALOG_LIST_PAGE_SIZE } from './ui/DialogListPagination';
import { DIALOG_LIST_SORT, dialogListNoopSort } from './ui/dialogListSort';
import { DotLabel } from './StatusDot';
import { SegmentedControl } from './ui/SegmentedControl';

export interface User {
  id: string;
  primaryEmail: string;
  name: { givenName: string; familyName: string; fullName: string };
  isAdmin: boolean;
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

interface ThirdPartyApp {
  clientId: string;
  displayText: string;
  anonymous: boolean;
  scopes: string[];
  nativeApp: boolean;
}

interface OrgUnit {
  orgUnitPath: string;
  name: string;
  displayName: string;
  level: number;
}

type ConfirmConfig = {
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
};

export interface EditUserDialogProps {
  open: boolean;
  user: User | null;
  organizationalUnits: OrgUnit[];
  loadingOrgUnits: boolean;
  onClose: () => void;
  onSaved: () => void;
  showSnackbar: (message: string, severity: AlertColor, action?: React.ReactNode) => void;
}

export function EditUserDialog({
  open,
  user,
  organizationalUnits,
  loadingOrgUnits,
  onClose,
  onSaved,
  showSnackbar,
}: EditUserDialogProps) {
  const [editingUser, setEditingUser] = useState<Partial<User>>({});
  const [thirdPartyApps, setThirdPartyApps] = useState<ThirdPartyApp[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [revokingApps, setRevokingApps] = useState(false);
  const [userGroups, setUserGroups] = useState<Array<{ id: string; email: string; name: string; description?: string }>>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [removingGroups, setRemovingGroups] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<ConfirmConfig | null>(null);
  const [groupsListPage, setGroupsListPage] = useState(0);
  const [appsListPage, setAppsListPage] = useState(0);
  const [groupsRowsPerPage, setGroupsRowsPerPage] = useState(DIALOG_LIST_PAGE_SIZE);
  const [appsRowsPerPage, setAppsRowsPerPage] = useState(DIALOG_LIST_PAGE_SIZE);
  const [dialogTab, setDialogTab] = useState(0);

  const theme = useTheme();
  useEffect(() => {
    if (!open || !user) return;
    setDialogTab(0);
    setEditingUser({
      name: { ...user.name },
      primaryEmail: user.primaryEmail,
      suspended: user.suspended,
      orgUnitPath: user.orgUnitPath || '/',
      department: user.department || '',
      location: user.location || '',
      phone: user.phone || '',
      notes: user.notes || '',
    });
    fetchThirdPartyApps(user.primaryEmail);
    fetchUserGroups(user.primaryEmail);
  }, [open, user?.primaryEmail]);

  useEffect(() => {
    if (!open || !user) return;
    setGroupsListPage(0);
    setAppsListPage(0);
  }, [open, user?.primaryEmail]);

  useEffect(() => {
    const max = Math.max(0, Math.ceil(userGroups.length / groupsRowsPerPage) - 1);
    setGroupsListPage((p) => Math.min(p, max));
  }, [userGroups.length, groupsRowsPerPage]);

  useEffect(() => {
    const max = Math.max(0, Math.ceil(thirdPartyApps.length / appsRowsPerPage) - 1);
    setAppsListPage((p) => Math.min(p, max));
  }, [thirdPartyApps.length, appsRowsPerPage]);

  const groupsMaxPage = Math.max(0, Math.ceil(userGroups.length / groupsRowsPerPage) - 1);
  const groupsPageSafe = Math.min(groupsListPage, groupsMaxPage);
  const pagedUserGroups = useMemo(() => {
    const start = groupsPageSafe * groupsRowsPerPage;
    return userGroups.slice(start, start + groupsRowsPerPage);
  }, [userGroups, groupsPageSafe, groupsRowsPerPage]);

  const appsMaxPage = Math.max(0, Math.ceil(thirdPartyApps.length / appsRowsPerPage) - 1);
  const appsPageSafe = Math.min(appsListPage, appsMaxPage);
  const pagedThirdPartyApps = useMemo(() => {
    const start = appsPageSafe * appsRowsPerPage;
    return thirdPartyApps.slice(start, start + appsRowsPerPage);
  }, [thirdPartyApps, appsPageSafe, appsRowsPerPage]);

  const reset = useCallback(() => {
    setEditingUser({});
    setThirdPartyApps([]);
    setSelectedApps(new Set());
    setUserGroups([]);
    setSelectedGroups(new Set());
    setConfirmConfig(null);
    setGroupsListPage(0);
    setAppsListPage(0);
    setGroupsRowsPerPage(DIALOG_LIST_PAGE_SIZE);
    setAppsRowsPerPage(DIALOG_LIST_PAGE_SIZE);
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  const fetchThirdPartyApps = async (email: string) => {
    try {
      setLoadingApps(true);
      const response = await apiClient.get(`/users/${email}/third-party-apps`);
      setThirdPartyApps(response.data);
    } catch {
      setThirdPartyApps([]);
    } finally {
      setLoadingApps(false);
    }
  };

  const fetchUserGroups = async (email: string) => {
    try {
      setLoadingGroups(true);
      const response = await apiClient.get(`/users/${email}/groups`);
      setUserGroups(response.data);
    } catch {
      setUserGroups([]);
    } finally {
      setLoadingGroups(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    try {
      const updates: Record<string, unknown> = {};
      if (editingUser.name?.givenName !== user.name.givenName) updates.givenName = editingUser.name?.givenName;
      if (editingUser.name?.familyName !== user.name.familyName) updates.familyName = editingUser.name?.familyName;
      if (editingUser.suspended !== undefined && editingUser.suspended !== user.suspended) updates.suspended = editingUser.suspended;
      if (editingUser.orgUnitPath && editingUser.orgUnitPath !== user.orgUnitPath) updates.orgUnitPath = editingUser.orgUnitPath;
      if ((editingUser.department ?? '') !== (user.department ?? '')) updates.department = editingUser.department ?? '';
      if (editingUser.location && editingUser.location !== user.location) updates.location = editingUser.location;
      if (editingUser.phone && editingUser.phone !== user.phone) updates.phone = editingUser.phone;
      if (editingUser.notes !== undefined && editingUser.notes !== user.notes) updates.notes = editingUser.notes;

      const hasUpdates = Object.keys(updates).length > 0;
      if (hasUpdates) {
        await apiClient.patch(`/users/${user.primaryEmail}`, updates);
        onSaved();
        showSnackbar('Changes saved — profile is up to date.', 'success');
      }
      handleClose();
    } catch {
      showSnackbar('We couldn\u2019t save those changes. Check your connection and try again.', 'error');
    }
  };

  const handleRevokeApp = (clientId: string) => {
    if (!user) return;
    setConfirmConfig({
      title: 'Revoke this third-party app?',
      description: <Typography variant="body2" color="text.secondary">The user may need to sign in again if they still rely on this app.</Typography>,
      confirmLabel: 'Revoke access',
      cancelLabel: 'Keep access',
      danger: true,
      onConfirm: async () => {
        await apiClient.delete(`/users/${user.primaryEmail}/third-party-apps/${clientId}`);
        await fetchThirdPartyApps(user.primaryEmail);
        showSnackbar('Access revoked for that app.', 'success');
      },
    });
  };

  const handleRevokeSelectedApps = () => {
    if (!user || selectedApps.size === 0) return;
    const appLabel = selectedApps.size === 1 ? 'this app' : `these ${selectedApps.size} apps`;
    setConfirmConfig({
      title: `Revoke ${selectedApps.size === 1 ? 'this' : 'these'} third-party app${selectedApps.size === 1 ? '' : 's'}?`,
      description: <Typography variant="body2" color="text.secondary">You're about to revoke {appLabel}. Users may need to reconnect integrations afterward.</Typography>,
      confirmLabel: 'Revoke selected',
      danger: true,
      onConfirm: async () => {
        try {
          setRevokingApps(true);
          for (const clientId of selectedApps) {
            try { await apiClient.delete(`/users/${user.primaryEmail}/third-party-apps/${clientId}`); } catch { /* continue */ }
          }
          await fetchThirdPartyApps(user.primaryEmail);
          setSelectedApps(new Set());
          showSnackbar('Finished revoking selected apps.', 'success');
        } finally {
          setRevokingApps(false);
        }
      },
    });
  };

  const handleRemoveGroup = async (groupEmail: string) => {
    if (!user) return;
    try {
      await apiClient.delete(`/groups/${encodeURIComponent(groupEmail)}/members/${encodeURIComponent(user.primaryEmail)}`);
      await fetchUserGroups(user.primaryEmail);
    } catch (error: any) {
      showSnackbar(error.response?.data?.error || 'Couldn\u2019t remove them from that group.', 'error');
    }
  };

  const handleRemoveSelectedGroups = () => {
    if (!user || selectedGroups.size === 0) return;
    const groupLabel = selectedGroups.size === 1 ? 'this group' : `these ${selectedGroups.size} groups`;
    setConfirmConfig({
      title: 'Remove user from groups?',
      description: <Typography variant="body2" color="text.secondary">They'll lose access tied to {groupLabel}. You can add them back later if needed.</Typography>,
      confirmLabel: 'Remove from selected',
      cancelLabel: 'Keep membership',
      danger: true,
      onConfirm: async () => {
        try {
          setRemovingGroups(true);
          for (const groupEmail of selectedGroups) {
            try { await apiClient.delete(`/groups/${encodeURIComponent(groupEmail)}/members/${encodeURIComponent(user.primaryEmail)}`); } catch { /* continue */ }
          }
          await fetchUserGroups(user.primaryEmail);
          setSelectedGroups(new Set());
          showSnackbar('Group memberships updated.', 'success');
        } finally {
          setRemovingGroups(false);
        }
      },
    });
  };

  const toggleSet = <T,>(set: Set<T>, key: T): Set<T> => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  };

  const sectionHeadingSx = {
    fontFamily: T.font,
    fontWeight: 600,
    fontSize: '0.6875rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    color: (t: any) => textTertiary(t),
  };

  const countBadgeSx = {
    fontFamily: T.font,
    fontSize: '0.6875rem',
    fontWeight: 500,
    color: (t: any) => textTertiary(t),
    ml: 0.75,
  };

  const actionBtnSx = {
    fontFamily: T.font,
    textTransform: 'none' as const,
    borderRadius: T.radius,
    fontSize: '0.8125rem',
    fontWeight: 500,
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: (th) => dialogPaperSx(th) }}
      >
        {/* ---- Title bar ---- */}
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1.5,
            pb: 1.5,
            borderBottom: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}`,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              sx={{
                fontFamily: T.font,
                fontWeight: 700,
                fontSize: '1.125rem',
                letterSpacing: '-0.02em',
                color: (t) => pick(t, T.text, '#fafafa'),
              }}
            >
              {user?.name.fullName ?? 'Edit User'}
            </Typography>
            {user && (
              <Typography
                sx={{
                  fontFamily: T.mono,
                  fontSize: '0.75rem',
                  color: (t) => textTertiary(t),
                  mt: 0.5,
                }}
              >
                {user.primaryEmail}
                {user.orgUnitPath ? ` · ${user.orgUnitPath}` : ''}
              </Typography>
            )}
          </Box>
          {user && (
            <Button
              size="small"
              component="a"
              href={`https://admin.google.com/ac/users/${encodeURIComponent(user.primaryEmail)}`}
              target="_blank"
              rel="noopener noreferrer"
              endIcon={<ExternalLink size={14} strokeWidth={1.75} />}
              sx={(th) => ({ ...dialogSecondaryButtonSx(th), height: 28, fontSize: '0.75rem', px: 1.25 })}
            >
              Open in Admin
            </Button>
          )}
          <IconButton size="small" onClick={handleClose} aria-label="Close" sx={{ color: (t) => textTertiary(t) }}>
            <X size={16} strokeWidth={1.75} />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ pt: '16px !important' }}>
          {user && (
            <Box>
              <Box sx={{ mb: 2 }}>
                <SegmentedControl value={dialogTab} options={['Profile', 'Groups', 'Apps']} onChange={setDialogTab} />
              </Box>

              {dialogTab === 0 && (
              <>
              <Grid container spacing={2} sx={{ mb: 1 }}>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ ...sectionHeadingSx, mb: 0.75 }}>First name</Typography>
                  <TextField
                    fullWidth size="small" hiddenLabel
                    value={editingUser.name?.givenName || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, name: { ...editingUser.name, givenName: e.target.value } as any })}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ ...sectionHeadingSx, mb: 0.75 }}>Last name</Typography>
                  <TextField
                    fullWidth size="small" hiddenLabel
                    value={editingUser.name?.familyName || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, name: { ...editingUser.name, familyName: e.target.value } as any })}
                  />
                </Grid>

                <Grid item xs={12}>
                  <Typography sx={{ ...sectionHeadingSx, mb: 0.75 }}>Primary email</Typography>
                  <TextField fullWidth size="small" hiddenLabel value={user.primaryEmail} InputProps={{ readOnly: true }} />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Typography sx={{ ...sectionHeadingSx, mb: 0.75 }}>Org unit</Typography>
                  <FormControl fullWidth size="small">
                    <Select
                      value={editingUser.orgUnitPath || '/'}
                      onChange={(e) => setEditingUser({ ...editingUser, orgUnitPath: e.target.value })}
                      disabled={loadingOrgUnits}
                      MenuProps={selectMenuProps}
                    >
                      {organizationalUnits.map((ou) => (
                        <MenuItem key={ou.orgUnitPath} value={ou.orgUnitPath}>
                          <Box sx={{ pl: ou.level * 2 }}>{ou.displayName}</Box>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Typography sx={{ ...sectionHeadingSx, mb: 0.75 }}>Status</Typography>
                  <FormControl fullWidth size="small">
                    <Select
                      value={editingUser.suspended ? 'suspended' : 'active'}
                      onChange={(e) => setEditingUser({ ...editingUser, suspended: e.target.value === 'suspended' })}
                      MenuProps={selectMenuProps}
                    >
                      <MenuItem value="active">Active</MenuItem>
                      <MenuItem value="suspended">Suspended</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Typography sx={{ ...sectionHeadingSx, mb: 0.75 }}>Department</Typography>
                  <TextField
                    fullWidth size="small" hiddenLabel
                    value={editingUser.department || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, department: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ ...sectionHeadingSx, mb: 0.75 }}>Location</Typography>
                  <TextField
                    fullWidth size="small" hiddenLabel
                    value={editingUser.location || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, location: e.target.value })}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Typography sx={{ ...sectionHeadingSx, mb: 0.75 }}>2FA</Typography>
                  <DotLabel
                    dotColor={user.isEnrolledIn2Sv ? T.success : T.warning}
                    dotTooltip={user.isEnrolledIn2Sv ? 'Enrolled' : 'Not enrolled'}
                  >
                    {user.isEnrolledIn2Sv ? 'Enrolled' : 'Not enrolled'}
                  </DotLabel>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography sx={{ ...sectionHeadingSx, mb: 0.75 }}>Last login</Typography>
                  <Typography sx={{ fontFamily: T.mono, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>
                    {user.lastLoginTime ? new Date(user.lastLoginTime).toLocaleString() : '—'}
                  </Typography>
                </Grid>

                <Grid item xs={12}>
                  <Typography sx={{ ...sectionHeadingSx, mb: 0.75 }}>Notes</Typography>
                  <TextField
                    fullWidth size="small" hiddenLabel
                    value={editingUser.notes || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, notes: e.target.value })}
                    multiline minRows={2}
                  />
                </Grid>
              </Grid>
              </>
              )}

              {dialogTab === 1 && (
              <>
              {/* ---- Groups ---- */}
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={1.5} mt={0.5}>
                <Box display="flex" alignItems="center">
                  <Typography sx={sectionHeadingSx}>Groups</Typography>
                  {!loadingGroups && userGroups.length > 0 && (
                    <Typography sx={countBadgeSx}>{userGroups.length}</Typography>
                  )}
                </Box>
                {userGroups.length > 0 && selectedGroups.size > 0 && (
                  <Button
                    size="small" variant="contained" color="error"
                    onClick={handleRemoveSelectedGroups} disabled={removingGroups}
                    sx={{ ...actionBtnSx, height: 30, px: 1.5 }}
                  >
                    Remove {selectedGroups.size} selected
                  </Button>
                )}
              </Box>
              {loadingGroups ? (
                <Box display="flex" justifyContent="center" p={3}><CircularProgress size={24} /></Box>
              ) : userGroups.length === 0 ? (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>Not a member of any groups</Typography>
                </Box>
              ) : (
                <ListShell>
                  <ListHeaderRow>
                    <Checkbox
                      size="small"
                      indeterminate={selectedGroups.size > 0 && selectedGroups.size < userGroups.length}
                      checked={userGroups.length > 0 && selectedGroups.size === userGroups.length}
                      onChange={(e) => setSelectedGroups(e.target.checked ? new Set(userGroups.map((g) => g.email)) : new Set())}
                      sx={{ p: 0.25, mr: 0.5 }}
                    />
                    <ColumnHeader label="Name" columnId="gn" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} width="30%" minWidth={140} />
                    <ColumnHeader label="Email" columnId="ge" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} minWidth={180} />
                    <ColumnHeader label="" columnId="gr" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} width={56} align="right" />
                  </ListHeaderRow>
                  {pagedUserGroups.map((group, idx) => {
                    const globalIdx = groupsPageSafe * groupsRowsPerPage + idx;
                    return (
                    <ListDataRow key={group.id} last={globalIdx === userGroups.length - 1}>
                      <Checkbox size="small" checked={selectedGroups.has(group.email)} onChange={() => setSelectedGroups(toggleSet(selectedGroups, group.email))} sx={{ p: 0.25, mr: 0.5 }} />
                      <Tooltip title={group.description || ''} placement="top" disableHoverListener={!group.description}>
                        <Box sx={{ width: '30%', minWidth: 140, overflow: 'hidden' }}>
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, color: (t) => pick(t, T.text, '#fafafa'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.name}</Typography>
                        </Box>
                      </Tooltip>
                      <Box sx={{ flex: 1, minWidth: 180, overflow: 'hidden' }}>
                        <Typography sx={{ fontFamily: T.mono, fontSize: '0.75rem', color: (t) => textSecondary(t), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.email}</Typography>
                      </Box>
                      <Box sx={{ width: 56, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
                        <ActionTooltip title="Remove from group">
                          <IconButton size="small" sx={{ color: T.danger }} onClick={() => handleRemoveGroup(group.email)}><Trash2 size={15} strokeWidth={1.75} /></IconButton>
                        </ActionTooltip>
                      </Box>
                    </ListDataRow>
                  );
                  })}
                  <DialogListPagination
                    page={groupsPageSafe}
                    rowsPerPage={groupsRowsPerPage}
                    total={userGroups.length}
                    onPageChange={setGroupsListPage}
                    onRowsPerPageChange={(n) => {
                      setGroupsRowsPerPage(n);
                      setGroupsListPage(0);
                    }}
                  />
                </ListShell>
              )}
              </>
              )}

              {dialogTab === 2 && (
              <>
              {/* ---- Third-Party Apps ---- */}
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={1.5} mt={0.5}>
                <Box display="flex" alignItems="center">
                  <Typography sx={sectionHeadingSx}>Third-Party Apps</Typography>
                  {!loadingApps && thirdPartyApps.length > 0 && (
                    <Typography sx={countBadgeSx}>{thirdPartyApps.length}</Typography>
                  )}
                </Box>
                {thirdPartyApps.length > 0 && selectedApps.size > 0 && (
                  <Button
                    size="small" variant="contained" color="error"
                    onClick={handleRevokeSelectedApps} disabled={revokingApps}
                    sx={{ ...actionBtnSx, height: 30, px: 1.5 }}
                  >
                    Revoke {selectedApps.size} selected
                  </Button>
                )}
              </Box>
              {loadingApps ? (
                <Box display="flex" justifyContent="center" p={3}><CircularProgress size={24} /></Box>
              ) : thirdPartyApps.length === 0 ? (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>No third-party apps connected</Typography>
                </Box>
              ) : (
                <ListShell>
                  <ListHeaderRow>
                    <Checkbox
                      size="small"
                      indeterminate={selectedApps.size > 0 && selectedApps.size < thirdPartyApps.length}
                      checked={thirdPartyApps.length > 0 && selectedApps.size === thirdPartyApps.length}
                      onChange={(e) => setSelectedApps(e.target.checked ? new Set(thirdPartyApps.map((a) => a.clientId)) : new Set())}
                      sx={{ p: 0.25, mr: 0.5 }}
                    />
                    <ColumnHeader label="App" columnId="an" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} width="22%" minWidth={140} />
                    <ColumnHeader label="Scopes" columnId="sc" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} minWidth={160} />
                    <ColumnHeader label="Type" columnId="tp" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} width={64} />
                    <ColumnHeader label="" columnId="rm" sortConfig={DIALOG_LIST_SORT} onSort={dialogListNoopSort} sortable={false} width={56} align="right" />
                  </ListHeaderRow>
                  {pagedThirdPartyApps.map((app, idx) => {
                    const globalIdx = appsPageSafe * appsRowsPerPage + idx;
                    return (
                    <ListDataRow key={app.clientId} last={globalIdx === thirdPartyApps.length - 1}>
                      <Checkbox size="small" checked={selectedApps.has(app.clientId)} onChange={() => setSelectedApps(toggleSet(selectedApps, app.clientId))} sx={{ p: 0.25, mr: 0.5 }} />
                      <Tooltip title={app.clientId} placement="top">
                        <Box sx={{ width: '22%', minWidth: 140, overflow: 'hidden' }}>
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, color: (t) => pick(t, T.text, '#fafafa'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.displayText}</Typography>
                        </Box>
                      </Tooltip>
                      <Box sx={{ flex: 1, minWidth: 160 }}>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
                          {app.scopes.slice(0, 3).map((scope, i) => (
                            <DotLabel key={i} dotColor={textTertiary(theme)}>
                              {scope.split('/').pop() || scope}
                            </DotLabel>
                          ))}
                          {app.scopes.length > 3 && (
                            <DotLabel dotColor={textTertiary(theme)}>{`+${app.scopes.length - 3}`}</DotLabel>
                          )}
                        </Box>
                      </Box>
                      <Box sx={{ width: 64, flexShrink: 0 }}>
                        <DotLabel dotColor={app.anonymous ? T.warning : textTertiary(theme)}>
                          <Box component="span" sx={{ color: app.anonymous ? T.warning : textSecondary(theme) }}>
                            {app.nativeApp ? 'Native' : 'Web'}
                          </Box>
                        </DotLabel>
                      </Box>
                      <Box sx={{ width: 56, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
                        <ActionTooltip title="Revoke app">
                          <IconButton size="small" onClick={() => handleRevokeApp(app.clientId)} sx={{ p: 0.5, color: T.danger }}><Trash2 size={15} strokeWidth={1.75} /></IconButton>
                        </ActionTooltip>
                      </Box>
                    </ListDataRow>
                  );
                  })}
                  <DialogListPagination
                    page={appsPageSafe}
                    rowsPerPage={appsRowsPerPage}
                    total={thirdPartyApps.length}
                    onPageChange={setAppsListPage}
                    onRowsPerPageChange={(n) => {
                      setAppsRowsPerPage(n);
                      setAppsListPage(0);
                    }}
                  />
                </ListShell>
              )}
              </>
              )}
            </Box>
          )}
        </DialogContent>

        {/* ---- Footer buttons ---- */}
        <DialogActions sx={(th) => dialogActionsSx(th)}>
          {user && !user.suspended && (
            <Button
              onClick={() => setEditingUser({ ...editingUser, suspended: true })}
              sx={{
                fontFamily: T.font,
                textTransform: 'none',
                borderRadius: T.radius,
                fontSize: '0.8125rem',
                fontWeight: 500,
                color: '#fca5a5',
                border: '1px solid rgba(220,38,38,0.4)',
                '&:hover': { bgcolor: 'rgba(220,38,38,0.12)' },
              }}
            >
              Suspend
            </Button>
          )}
          {user && user.suspended && (
            <Button
              onClick={() => setEditingUser({ ...editingUser, suspended: false })}
              sx={(th) => dialogSecondaryButtonSx(th)}
            >
              Unsuspend
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button onClick={handleClose} sx={(th) => dialogCancelButtonSx(th)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            data-testid="save-changes"
            sx={(th) => dialogPrimaryButtonSx(th)}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmConfig !== null}
        title={confirmConfig?.title ?? ''}
        confirmLabel={confirmConfig?.confirmLabel}
        cancelLabel={confirmConfig?.cancelLabel}
        danger={confirmConfig?.danger}
        onClose={() => setConfirmConfig(null)}
        onConfirm={async () => { if (confirmConfig) await confirmConfig.onConfirm(); }}
      >
        {confirmConfig?.description}
      </ConfirmDialog>
    </>
  );
}
