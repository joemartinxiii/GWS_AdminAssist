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
  InputLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Checkbox,
  Tooltip,
} from '@mui/material';
import type { AlertColor } from '@mui/material';
import { Trash2 } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { apiClient } from '../services/api.client';
import { ConfirmDialog } from './ConfirmDialog';
import { ActionTooltip } from './ActionTooltip';
import { T, pick, selectMenuProps, textSecondary, textTertiary, dialogPaperSx } from '../theme/designTokens';
import { ColumnHeader } from './ui/ColumnHeader';
import { ListShell, ListHeaderRow, ListDataRow } from './ui/ListShell';
import { DialogListPagination, DIALOG_LIST_PAGE_SIZE } from './ui/DialogListPagination';
import { DIALOG_LIST_SORT, dialogListNoopSort } from './ui/dialogListSort';
import { DotLabel } from './StatusDot';

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

  const theme = useTheme();
  useEffect(() => {
    if (!open || !user) return;
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

  const initials = user
    ? user.name.fullName.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '';

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
        {/* ---- Title bar with avatar ---- */}
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            pb: 1.5,
            borderBottom: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}`,
          }}
        >
          {user && (
            <Box
              sx={(t) => ({
                width: 40,
                height: 40,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
                fontSize: '0.8125rem',
                letterSpacing: '0.02em',
                fontFamily: T.font,
                flexShrink: 0,
                bgcolor: user.suspended
                  ? pick(t, T.dangerSoft, '#3f1a1a')
                  : pick(t, T.accentSoft, 'rgba(26, 115, 232, 0.2)'),
                color: user.suspended
                  ? pick(t, T.danger, '#fca5a5')
                  : pick(t, T.accent, '#8ab4f8'),
              })}
            >
              {initials}
            </Box>
          )}
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
                  color: (t) => textSecondary(t),
                  mt: 0.25,
                }}
              >
                {user.primaryEmail}
              </Typography>
            )}
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: '20px !important' }}>
          {user && (
            <Box>
              {/* ---- Profile ---- */}
              <Typography sx={{ ...sectionHeadingSx, mb: 2 }}>Profile</Typography>

              <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth size="small" label="First Name"
                    value={editingUser.name?.givenName || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, name: { ...editingUser.name, givenName: e.target.value } as any })}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth size="small" label="Last Name"
                    value={editingUser.name?.familyName || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, name: { ...editingUser.name, familyName: e.target.value } as any })}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth size="small" label="Department"
                    value={editingUser.department || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, department: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth size="small" label="Location"
                    value={editingUser.location || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, location: e.target.value })}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth size="small" label="Phone"
                    value={editingUser.phone || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Org Unit</InputLabel>
                    <Select
                      value={editingUser.orgUnitPath || '/'}
                      label="Org Unit"
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
                  <FormControl fullWidth size="small">
                    <InputLabel>Status</InputLabel>
                    <Select
                      value={editingUser.suspended ? 'suspended' : 'active'}
                      label="Status"
                      onChange={(e) => setEditingUser({ ...editingUser, suspended: e.target.value === 'suspended' })}
                      MenuProps={selectMenuProps}
                    >
                      <MenuItem value="active">Active</MenuItem>
                      <MenuItem value="suspended">Suspended</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    fullWidth size="small" label="Notes"
                    value={editingUser.notes || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, notes: e.target.value })}
                    multiline minRows={2}
                  />
                </Grid>
              </Grid>

              <Divider sx={{ my: 3, borderColor: (t) => pick(t, T.borderSubtle, '#27272a') }} />

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

              <Divider sx={{ my: 3, borderColor: (t) => pick(t, T.borderSubtle, '#27272a') }} />

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
            </Box>
          )}
        </DialogContent>

        {/* ---- Footer buttons ---- */}
        <DialogActions
          sx={{
            px: 3,
            py: 2,
            borderTop: (t) => `1px solid ${pick(t, T.borderSubtle, '#27272a')}`,
            gap: 1,
          }}
        >
          <Button
            onClick={handleClose}
            sx={{
              ...actionBtnSx,
              color: (t) => textSecondary(t),
              '&:hover': { bgcolor: (t) => pick(t, '#f0f0ec', '#27272a') },
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            data-testid="save-changes"
            sx={{
              ...actionBtnSx,
              bgcolor: T.accent,
              '&:hover': { bgcolor: T.accentHover },
              px: 2.5,
            }}
          >
            Save Changes
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
