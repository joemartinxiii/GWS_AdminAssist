import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  Checkbox,
  Tooltip,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  InputAdornment,
  Chip,
} from '@mui/material';
import { Search, X, Save, Send, ChevronDown, ChevronUp, HelpCircle, FileCode } from 'lucide-react';
import { apiClient } from '../services/api.client';
import { T, pick, textSecondary, textTertiary, dialogPaperSx } from '../theme/designTokens';
import { useSnackbar } from '../hooks/useSnackbar';
import { getApiErrorMessage } from '../utils/apiError';

// ---------------------------------------------------------------------------
// Variable definitions
// ---------------------------------------------------------------------------
interface SignatureVar {
  key: string;
  label: string;
  example: string;
}

const VARIABLES: SignatureVar[] = [
  { key: 'firstName',  label: 'First name',  example: 'Jane' },
  { key: 'lastName',   label: 'Last name',   example: 'Smith' },
  { key: 'fullName',   label: 'Full name',   example: 'Jane Smith' },
  { key: 'email',      label: 'Email',       example: 'jane.smith@company.com' },
  { key: 'title',      label: 'Job title',   example: 'Software Engineer' },
  { key: 'department', label: 'Department',  example: 'Engineering' },
  { key: 'phone',      label: 'Phone',       example: '+1 (555) 000-0000' },
  { key: 'company',    label: 'Company',     example: 'Acme Corp' },
];

const SAMPLE_VALUES = Object.fromEntries(VARIABLES.map((v) => [v.key, v.example]));

function substitutePreview(template: string): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => SAMPLE_VALUES[key] ?? `{{${key}}}`);
}

const EXAMPLE_TEMPLATE = `<table cellpadding="0" cellspacing="0" style="font-family: Arial, sans-serif; font-size: 14px; color: #1a1a1a;">
  <tr>
    <td style="padding-right: 16px; vertical-align: top;">
      <!-- Replace FILE_ID with your Google Drive logo file ID -->
      <img src="https://drive.google.com/uc?export=view&id=FILE_ID"
           width="80" alt="Company Logo"
           style="display: block; border: 0;" />
    </td>
    <td style="border-left: 2px solid #1a73e8; padding-left: 16px; vertical-align: top;">
      <p style="margin: 0; font-weight: 700; font-size: 15px;">{{fullName}}</p>
      <p style="margin: 2px 0 0; color: #555; font-size: 13px;">{{title}}{{department ? ' · ' + department : ''}}</p>
      <p style="margin: 6px 0 0; font-size: 13px;">
        <a href="mailto:{{email}}" style="color: #1a73e8; text-decoration: none;">{{email}}</a>
      </p>
      {{phone ? '<p style="margin: 2px 0 0; font-size: 13px; color: #555;">{{phone}}</p>' : ''}}
    </td>
  </tr>
</table>`.trim();

interface UserRow {
  primaryEmail: string;
  name: { fullName: string };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function EmailSignatures() {
  const { snackbar, showSuccess, showError } = useSnackbar();
  const [templateHtml, setTemplateHtml]           = useState('');
  const [templateLoading, setTemplateLoading]     = useState(true);
  const [loadError, setLoadError]                 = useState<string | null>(null);
  const [templateSaving, setTemplateSaving]       = useState(false);
  const [templateUpdatedAt, setTemplateUpdatedAt] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess]             = useState(false);
  const [helpOpen, setHelpOpen]                   = useState(false);

  const [users, setUsers]             = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);

  // Push dialog state
  const [pushOpen, setPushOpen]               = useState(false);
  const [pushSearch, setPushSearch]           = useState('');
  const [selectedEmails, setSelectedEmails]   = useState<Set<string>>(new Set());
  const [applying, setApplying]               = useState(false);
  const [pushResult, setPushResult]           = useState<{
    succeeded: string[];
    failed: Array<{ email: string; error: string }>;
  } | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);

  // ---- data loading --------------------------------------------------------
  const loadTemplate = useCallback(async () => {
    setTemplateLoading(true);
    try {
      const { data } = await apiClient.get<{ html: string; updatedAt: string | null }>('/gmail/signatures/template');
      setTemplateHtml(data.html || '');
      setTemplateUpdatedAt(data.updatedAt ?? null);
      setLoadError(null);
    } catch (e) {
      console.error(e);
      setLoadError(getApiErrorMessage(e, 'Failed to load signature template.'));
    } finally {
      setTemplateLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const { data } = await apiClient.get<Array<{ primaryEmail: string; name: { fullName: string } }>>('/users', {
        params: { maxResults: 500 },
      });
      setUsers((data || []).map((u) => ({ primaryEmail: u.primaryEmail, name: { fullName: u.name?.fullName ?? u.primaryEmail } })));
    } catch (e) {
      console.error(e);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => { loadTemplate(); }, [loadTemplate]);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  // ---- save ----------------------------------------------------------------
  const handleSave = async () => {
    setTemplateSaving(true);
    try {
      const { data } = await apiClient.post<{ html: string; updatedAt: string | null }>('/gmail/signatures/template', { html: templateHtml });
      setTemplateHtml(data.html);
      setTemplateUpdatedAt(data.updatedAt ?? null);
      setSaveSuccess(true);
      showSuccess('Signature template saved.');
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e: any) {
      console.error(e);
      showError(e, 'Failed to save template.');
    } finally {
      setTemplateSaving(false);
    }
  };

  // ---- variable insertion --------------------------------------------------
  const insertVariable = (key: string) => {
    const snippet = `{{${key}}}`;
    const ta = editorRef.current;
    if (!ta) {
      setTemplateHtml((h) => h + snippet);
      return;
    }
    const start = ta.selectionStart ?? templateHtml.length;
    const end   = ta.selectionEnd   ?? start;
    const next  = templateHtml.slice(0, start) + snippet + templateHtml.slice(end);
    setTemplateHtml(next);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + snippet.length;
      ta.focus();
    });
  };

  // ---- push dialog ---------------------------------------------------------
  const openPush = () => {
    setSelectedEmails(new Set(users.map((u) => u.primaryEmail)));
    setPushSearch('');
    setPushResult(null);
    setPushOpen(true);
  };

  const filteredDialogUsers = useMemo(() => {
    const q = pushSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.primaryEmail.toLowerCase().includes(q) || u.name.fullName.toLowerCase().includes(q)
    );
  }, [users, pushSearch]);

  const allFilteredSelected = filteredDialogUsers.length > 0 && filteredDialogUsers.every((u) => selectedEmails.has(u.primaryEmail));

  const toggleUser = (email: string) => {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredDialogUsers.forEach((u) => next.delete(u.primaryEmail));
      else filteredDialogUsers.forEach((u) => next.add(u.primaryEmail));
      return next;
    });
  };

  const handlePush = async () => {
    const emails = Array.from(selectedEmails);
    if (emails.length === 0) return;

    setApplying(true);
    setPushResult(null);
    try {
      const { data } = await apiClient.post<{ succeeded: string[]; failed: Array<{ email: string; error: string }> }>(
        '/gmail/signatures/batch',
        { userEmails: emails, signatureHtml: templateHtml }
      );
      setPushResult(data);
      if (data.failed.length === 0) showSuccess('Signatures applied.');
    } catch (e: any) {
      console.error(e);
      showError(e, 'Failed to push signatures.');
    } finally {
      setApplying(false);
    }
  };

  // ---- preview html --------------------------------------------------------
  const previewHtml = useMemo(() => substitutePreview(templateHtml), [templateHtml]);

  // ==========================================================================
  // Render
  // ==========================================================================
  return (
    <Box sx={{ fontFamily: T.font }}>

      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.02em', color: (theme) => pick(theme, T.text, '#fafafa') }}>
            Email Signatures
          </Typography>
          {templateUpdatedAt && (
            <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textSecondary(t), mt: 0.25 }}>
              Last saved {new Date(templateUpdatedAt).toLocaleString()}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          {saveSuccess && (
            <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: T.success }}>
              Saved
            </Typography>
          )}
          <Button
            size="small"
            variant="outlined"
            startIcon={<FileCode size={15} strokeWidth={1.75} />}
            onClick={() => { setTemplateHtml(EXAMPLE_TEMPLATE); setHelpOpen(false); }}
            sx={(theme) => ({
              fontFamily: T.font,
              textTransform: 'none',
              borderRadius: T.radius,
              fontSize: '0.8125rem',
              fontWeight: 500,
              height: 30,
              px: 1.5,
              borderColor: pick(theme, T.border, '#3f3f46'),
              color: pick(theme, T.text, '#fafafa'),
              '&:hover': { borderColor: pick(theme, T.accent, '#8ab4f8'), bgcolor: pick(theme, T.accentSoft, 'rgba(26,115,232,0.12)') },
            })}
          >
            Load example
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<HelpCircle size={15} strokeWidth={1.75} />}
            endIcon={helpOpen ? <ChevronUp size={13} strokeWidth={2} /> : <ChevronDown size={13} strokeWidth={2} />}
            onClick={() => setHelpOpen((v) => !v)}
            sx={(theme) => ({
              fontFamily: T.font,
              textTransform: 'none',
              borderRadius: T.radius,
              fontSize: '0.8125rem',
              fontWeight: 500,
              height: 30,
              px: 1.5,
              borderColor: helpOpen ? T.accent : pick(theme, T.border, '#3f3f46'),
              color: helpOpen ? T.accent : pick(theme, T.text, '#fafafa'),
              bgcolor: helpOpen ? pick(theme, T.accentSoft, 'rgba(26,115,232,0.12)') : 'transparent',
              '&:hover': { borderColor: T.accent, bgcolor: pick(theme, T.accentSoft, 'rgba(26,115,232,0.12)'), color: T.accent },
            })}
          >
            How to use
          </Button>
          <Button
            size="small"
            variant="outlined"
            data-testid="save-signature-template"
            startIcon={templateSaving ? <CircularProgress size={14} color="inherit" /> : <Save size={15} strokeWidth={1.75} />}
            onClick={handleSave}
            disabled={templateSaving || templateLoading}
            sx={(theme) => ({
              fontFamily: T.font,
              textTransform: 'none',
              borderRadius: T.radius,
              fontSize: '0.8125rem',
              fontWeight: 500,
              height: 30,
              px: 1.5,
              borderColor: pick(theme, T.border, '#3f3f46'),
              color: pick(theme, T.text, '#fafafa'),
              '&:hover': { borderColor: pick(theme, T.accent, '#8ab4f8'), bgcolor: pick(theme, T.accentSoft, 'rgba(26,115,232,0.12)') },
            })}
          >
            Save
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<Send size={15} strokeWidth={1.75} />}
            onClick={openPush}
            disabled={!templateHtml.trim() || usersLoading}
            sx={{
              fontFamily: T.font,
              textTransform: 'none',
              borderRadius: T.radius,
              fontSize: '0.8125rem',
              fontWeight: 600,
              height: 30,
              px: 1.5,
              bgcolor: T.accent,
              color: '#ffffff',
              boxShadow: 'none',
              '&:hover': { bgcolor: T.accentHover, boxShadow: 'none' },
            }}
          >
            Push to users
          </Button>
        </Box>
      </Box>

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setLoadError(null)}>{loadError}</Alert>
      )}

      {/* Collapsible help panel */}
      <Box sx={{
        overflow: 'hidden',
        maxHeight: helpOpen ? 600 : 0,
        opacity: helpOpen ? 1 : 0,
        transition: 'max-height 0.3s ease, opacity 0.2s ease, margin 0.3s ease',
        mb: helpOpen ? 2.5 : 0,
      }}>
        <Box sx={(theme) => ({
          p: 2.5,
          borderRadius: T.radius,
          border: `1px solid ${pick(theme, T.border, '#3f3f46')}`,
          bgcolor: pick(theme, T.surface, '#18181b'),
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          gap: 3,
        })}>

          {/* Column 1: How it works + Variables */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Typography sx={{ fontFamily: T.font, fontWeight: 600, fontSize: '0.875rem', mb: 0.75, color: (t) => pick(t, T.text, '#fafafa') }}>
                How it works
              </Typography>
              <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), lineHeight: 1.6 }}>
                Write an HTML template using the variables below, then save it. When you push, each user gets their own personalized version — variables are replaced with their actual profile data from Google Directory before their signature is set.
              </Typography>
              <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), lineHeight: 1.6, mt: 0.75 }}>
                If a field is empty for a user (e.g. no job title set in the directory), the variable is replaced with an empty string rather than showing the placeholder.
              </Typography>
            </Box>

            <Box>
              <Typography sx={{ fontFamily: T.font, fontWeight: 600, fontSize: '0.875rem', mb: 0.75, color: (t) => pick(t, T.text, '#fafafa') }}>
                Available variables
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {VARIABLES.map((v) => (
                  <Box key={v.key} sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
                    <Typography sx={{ fontFamily: T.mono, fontSize: '0.75rem', color: T.accent, flexShrink: 0, minWidth: 120 }}>
                      {`{{${v.key}}}`}
                    </Typography>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>
                      {v.label} <Box component="span" sx={{ color: (t) => textTertiary(t) }}>(e.g. "{v.example}")</Box>
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>

          {/* Column 2: Logo + Tips */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Typography sx={{ fontFamily: T.font, fontWeight: 600, fontSize: '0.875rem', mb: 0.75, color: (t) => pick(t, T.text, '#fafafa') }}>
                Adding a company logo
              </Typography>
              <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), lineHeight: 1.6 }}>
                Host your logo at a public URL and reference it with an{' '}
                <Box component="span" sx={{ fontFamily: T.mono, fontSize: '0.75rem', color: T.accent }}>&lt;img src="..."&gt;</Box>{' '}
                tag. Google Drive works well — upload your logo, set sharing to <strong>"Anyone with the link can view"</strong>, then use this URL format:
              </Typography>
              <Box sx={(theme) => ({
                mt: 1,
                p: 1.25,
                borderRadius: T.radiusSm,
                bgcolor: pick(theme, '#f5f5f3', '#09090b'),
                border: `1px solid ${pick(theme, T.border, '#27272a')}`,
                fontFamily: T.mono,
                fontSize: '0.72rem',
                color: T.accent,
                wordBreak: 'break-all',
                lineHeight: 1.5,
              })}>
                https://drive.google.com/uc?export=view&id=<Box component="span" sx={{ color: (t) => textSecondary(t) }}>YOUR_FILE_ID</Box>
              </Box>
              <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textTertiary(t), mt: 0.75, lineHeight: 1.5 }}>
                Find the file ID in the share URL between <Box component="span" sx={{ fontFamily: T.mono, fontSize: '0.7rem' }}>/d/</Box> and <Box component="span" sx={{ fontFamily: T.mono, fontSize: '0.7rem' }}>/view</Box>.
              </Typography>
            </Box>

            <Box>
              <Typography sx={{ fontFamily: T.font, fontWeight: 600, fontSize: '0.875rem', mb: 0.75, color: (t) => pick(t, T.text, '#fafafa') }}>
                Tips
              </Typography>
              {[
                'Use inline styles (style="...") rather than CSS classes — many email clients ignore external stylesheets.',
                'Test in Gmail by pushing to yourself first before rolling out to everyone.',
                'Images may be blocked by some recipients until they click "load images" — this is normal.',
                'Keep the signature concise: name, title, email, and phone is usually enough.',
              ].map((tip, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 1, mb: 0.75 }}>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: T.accent, flexShrink: 0, lineHeight: 1.6 }}>·</Typography>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), lineHeight: 1.6 }}>
                    {tip}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>

        </Box>
      </Box>

      {templateLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={32} />
        </Box>
      ) : (
        <>
          {/* Variable chips */}
          <Box sx={(theme) => ({
            mb: 2,
            p: 1.5,
            borderRadius: T.radius,
            border: `1px solid ${pick(theme, T.border, '#3f3f46')}`,
            bgcolor: pick(theme, T.surface, '#18181b'),
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 1,
          })}>
            <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', fontWeight: 500, color: (t) => textSecondary(t), mr: 0.5 }}>
              Insert variable:
            </Typography>
            {VARIABLES.map((v) => (
              <Tooltip key={v.key} title={`Preview: ${v.example}`} placement="top">
                <Chip
                  label={`{{${v.key}}}`}
                  size="small"
                  onClick={() => insertVariable(v.key)}
                  sx={(theme) => ({
                    fontFamily: T.mono,
                    fontSize: '0.75rem',
                    height: 26,
                    bgcolor: pick(theme, T.accentSoft, 'rgba(26,115,232,0.15)'),
                    color: T.accent,
                    border: `1px solid ${pick(theme, T.accentBorder, 'rgba(26,115,232,0.4)')}`,
                    cursor: 'pointer',
                    '&:hover': { bgcolor: pick(theme, '#dce8fd', 'rgba(26,115,232,0.25)') },
                  })}
                />
              </Tooltip>
            ))}
          </Box>

          {/* Editor + Preview */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2.5 }}>

            {/* Editor */}
            <Box>
              <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', fontWeight: 600, color: (t) => textSecondary(t), mb: 0.75, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                HTML Template
              </Typography>
              <TextField
                fullWidth
                multiline
                minRows={18}
                placeholder={'<p>Hi {{firstName}},</p>\n<p>—<br/><strong>{{fullName}}</strong><br/>{{title}} · {{department}}<br/>{{phone}}</p>'}
                value={templateHtml}
                onChange={(e) => setTemplateHtml(e.target.value)}
                inputRef={editorRef}
                sx={(theme) => ({
                  '& .MuiOutlinedInput-root': {
                    fontFamily: T.mono,
                    fontSize: '0.8125rem',
                    lineHeight: 1.6,
                    borderRadius: T.radius,
                    bgcolor: pick(theme, T.surface, '#18181b'),
                    '& fieldset': { borderColor: pick(theme, T.border, '#3f3f46') },
                    '&:hover fieldset': { borderColor: pick(theme, T.textTertiary, '#52525b') },
                    '&.Mui-focused fieldset': { borderColor: T.accent },
                  },
                  '& .MuiOutlinedInput-input': { fontFamily: T.mono },
                })}
              />
            </Box>

            {/* Preview */}
            <Box>
              <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', fontWeight: 600, color: (t) => textSecondary(t), mb: 0.75, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Preview <Typography component="span" sx={{ fontFamily: T.font, fontSize: '0.7rem', textTransform: 'none', color: (t) => textTertiary(t), letterSpacing: 0 }}>(sample values)</Typography>
              </Typography>
              <Paper
                variant="outlined"
                sx={(theme) => ({
                  p: 2.5,
                  minHeight: 320,
                  borderRadius: T.radius,
                  border: `1px solid ${pick(theme, T.border, '#3f3f46')}`,
                  bgcolor: pick(theme, '#ffffff', '#18181b'),
                  fontFamily: T.font,
                  fontSize: '0.875rem',
                })}
              >
                {templateHtml.trim() ? (
                  <Box
                    component="div"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                    sx={{ '& *': { fontFamily: 'inherit' } }}
                  />
                ) : (
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textTertiary(t), fontStyle: 'italic' }}>
                    Your signature preview will appear here as you type.
                  </Typography>
                )}
              </Paper>
              <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {VARIABLES.map((v) => (
                  <Typography key={v.key} sx={{ fontFamily: T.font, fontSize: '0.7rem', color: (t) => textTertiary(t) }}>
                    <Box component="span" sx={{ fontFamily: T.mono, color: T.accent }}>{`{{${v.key}}}`}</Box>
                    {` = "${v.example}"`}
                  </Typography>
                ))}
              </Box>
            </Box>

          </Box>
        </>
      )}

      {/* ---- Push dialog ---- */}
      <Dialog
        open={pushOpen}
        onClose={() => !applying && setPushOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: (th) => dialogPaperSx(th) }}
      >
        <DialogTitle sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1rem', pb: 0.5 }}>
          Push signature to users
          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), fontWeight: 400, mt: 0.25 }}>
            Each user's signature will be personalized using their directory information.
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pt: '20px !important' }}>

          {pushResult ? (
            <Alert
              severity={pushResult.failed.length ? 'warning' : 'success'}
              onClose={() => setPushResult(null)}
              sx={{ mb: 2, fontFamily: T.font, fontSize: '0.8125rem' }}
            >
              {pushResult.succeeded.length} succeeded
              {pushResult.failed.length > 0 &&
                `; ${pushResult.failed.length} failed (${pushResult.failed.slice(0, 3).map((f) => f.email).join(', ')}${pushResult.failed.length > 3 ? '…' : ''})`}
            </Alert>
          ) : null}

          {/* Search */}
          <TextField
            autoFocus
            size="small"
            fullWidth
            placeholder="Search users..."
            value={pushSearch}
            onChange={(e) => setPushSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Box component="span" sx={{ display: 'flex', color: (t: any) => textTertiary(t) }}>
                    <Search size={16} strokeWidth={1.75} />
                  </Box>
                </InputAdornment>
              ),
              ...(pushSearch ? {
                endAdornment: (
                  <InputAdornment position="end">
                    <Box component="span" onClick={() => setPushSearch('')} sx={{ display: 'flex', cursor: 'pointer', color: (t: any) => textTertiary(t) }}>
                      <X size={14} strokeWidth={2} />
                    </Box>
                  </InputAdornment>
                ),
              } : {}),
            }}
            sx={(theme) => ({
              mb: 1.5,
              '& .MuiOutlinedInput-root': {
                fontFamily: T.font,
                fontSize: '0.8125rem',
                borderRadius: T.radius,
                bgcolor: pick(theme, T.bg, '#09090b'),
                '& fieldset': { borderColor: pick(theme, T.border, '#3f3f46') },
                '&:hover fieldset': { borderColor: pick(theme, T.textTertiary, '#52525b') },
                '&.Mui-focused fieldset': { borderColor: T.accent },
              },
            })}
          />

          {/* Select-all row */}
          <Box
            sx={(theme) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1,
              py: 0.5,
              mb: 0.5,
              borderRadius: T.radiusSm,
              bgcolor: pick(theme, T.bg, '#09090b'),
              border: `1px solid ${pick(theme, T.border, '#3f3f46')}`,
            })}
          >
            <Checkbox
              size="small"
              indeterminate={selectedEmails.size > 0 && !allFilteredSelected}
              checked={allFilteredSelected}
              onChange={toggleAllFiltered}
              sx={{ p: 0.25 }}
            />
            <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, flex: 1, color: (t) => textSecondary(t) }}>
              {selectedEmails.size === 0
                ? 'Select all'
                : `${selectedEmails.size} of ${users.length} users selected`}
            </Typography>
          </Box>

          {/* User list */}
          <Box sx={(theme) => ({
            maxHeight: 280,
            overflowY: 'auto',
            borderRadius: T.radius,
            border: `1px solid ${pick(theme, T.border, '#3f3f46')}`,
          })}>
            {filteredDialogUsers.map((u, idx) => (
              <Box
                key={u.primaryEmail}
                onClick={() => toggleUser(u.primaryEmail)}
                sx={(theme) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 0.75,
                  cursor: 'pointer',
                  borderBottom: idx < filteredDialogUsers.length - 1 ? `1px solid ${pick(theme, T.borderSubtle, '#27272a')}` : 'none',
                  '&:hover': { bgcolor: pick(theme, T.surfaceHover, '#27272a') },
                  bgcolor: selectedEmails.has(u.primaryEmail)
                    ? pick(theme, T.accentSoft, 'rgba(26,115,232,0.08)')
                    : 'transparent',
                })}
              >
                <Checkbox size="small" checked={selectedEmails.has(u.primaryEmail)} onChange={() => toggleUser(u.primaryEmail)} sx={{ p: 0.25 }} onClick={(e) => e.stopPropagation()} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 500, color: (t) => pick(t, T.text, '#fafafa'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.name.fullName}
                  </Typography>
                  <Typography sx={{ fontFamily: T.mono, fontSize: '0.7rem', color: (t) => textSecondary(t), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.primaryEmail}
                  </Typography>
                </Box>
              </Box>
            ))}
            {filteredDialogUsers.length === 0 && (
              <Box sx={{ py: 3, textAlign: 'center' }}>
                <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textTertiary(t) }}>No users found</Typography>
              </Box>
            )}
          </Box>

        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button
            onClick={() => setPushOpen(false)}
            disabled={applying}
            sx={(theme) => ({
              fontFamily: T.font,
              textTransform: 'none',
              borderRadius: T.radius,
              fontSize: '0.8125rem',
              color: pick(theme, T.text, '#fafafa'),
            })}
          >
            {pushResult ? 'Close' : 'Cancel'}
          </Button>
          {!pushResult && (
            <Button
              variant="contained"
              onClick={handlePush}
              disabled={applying || selectedEmails.size === 0}
              startIcon={applying ? <CircularProgress size={14} color="inherit" /> : <Send size={14} strokeWidth={1.75} />}
              sx={{
                fontFamily: T.font,
                textTransform: 'none',
                borderRadius: T.radius,
                fontSize: '0.8125rem',
                fontWeight: 600,
                bgcolor: T.accent,
                color: '#ffffff',
                boxShadow: 'none',
                '&:hover': { bgcolor: T.accentHover, boxShadow: 'none' },
              }}
            >
              {applying ? 'Pushing…' : `Push to ${selectedEmails.size} user${selectedEmails.size !== 1 ? 's' : ''}`}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {snackbar}
    </Box>
  );
}
