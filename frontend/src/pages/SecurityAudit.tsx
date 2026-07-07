import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  LinearProgress,
  Button,
  Menu,
  IconButton,
  Tooltip,
  useMediaQuery,
  useTheme,
  Snackbar,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import { Download, CloudUpload, FileText, ChevronDown, Play, EyeOff, RotateCcw, Pencil } from 'lucide-react';
import { apiClient } from '../services/api.client';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { T, pick, menuPaperProps, textSecondary, textTertiary, exportToolbarButtonSx } from '../theme/designTokens';
import { ExportMenuRow } from '../components/ExportButton';
import { getApiErrorMessage } from '../utils/apiError';
import { ColumnHeader } from '../components/ui/ColumnHeader';
import { ListShell, ListHeaderRow, ListDataRow } from '../components/ui/ListShell';
import { DotLabel } from '../components/StatusDot';
import { SegmentedControl } from '../components/ui/SegmentedControl';

const STATIC_SORT = { key: '_', direction: 'asc' as const };
const noopSort = () => {};

/** Same section order as backend / GWS_HARDENING.md / source hardening checklist */
const HARDENING_CATEGORY_ORDER = [
  'Authentication',
  'Email',
  'Advanced Phishing & Malware',
  'Calendar',
  'Google Drive',
  'Chrome Managed Browsers',
  'Login Challenges',
  'Data Download',
  'Apps Control',
];

function orderedHardeningCategories(categories: string[]): string[] {
  const uniq = [...new Set(categories)];
  return uniq.sort((a, b) => {
    const ia = HARDENING_CATEGORY_ORDER.indexOf(a);
    const ib = HARDENING_CATEGORY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

const IGNORED_CHECKS_STORAGE_KEY = 'gws-hardening-ignored-ids';

function loadIgnoredIdsFromStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(IGNORED_CHECKS_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function persistIgnoredIds(ids: Set<string>) {
  localStorage.setItem(IGNORED_CHECKS_STORAGE_KEY, JSON.stringify([...ids]));
}

const WAIVE_REASONS_STORAGE_KEY = 'gws-hardening-waive-reasons';

function loadWaiveReasonsFromStorage(): Record<string, string> {
  try {
    const raw = localStorage.getItem(WAIVE_REASONS_STORAGE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return Object.fromEntries(
        Object.entries(obj as Record<string, unknown>).filter(
          ([, v]) => typeof v === 'string'
        ) as [string, string][]
      );
    }
    return {};
  } catch {
    return {};
  }
}

function persistWaiveReasons(reasons: Record<string, string>) {
  localStorage.setItem(WAIVE_REASONS_STORAGE_KEY, JSON.stringify(reasons));
}

// SegmentedControl extracted to shared component

interface HardeningCheck {
  id: string;
  category: string;
  name: string;
  description: string;
  status: 'pass' | 'warning' | 'fail' | 'manual' | 'info';
  source?: 'auto' | 'manual';
  currentValue?: any;
  recommendedValue?: any;
  recommendation: string;
  adminConsoleUrl?: string;
  issues?: string[];
}

interface HardeningData {
  checks: HardeningCheck[];
  statistics: {
    total: number;
    pass: number;
    warning: number;
    fail: number;
    manual: number;
    info: number;
  };
}

const PDF_MARGIN = 14;
const PDF_COLS = 5;

function truncatePdfText(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatPdfValue(v: unknown): string {
  const s = String(v ?? '').trim();
  return s === '' ? '—' : s;
}

/** PDF layout aligned with the Security audit page: summary strip, categories, status colors. */
function exportSecurityAuditToPdf(
  hardeningData: HardeningData,
  ignoredIds: Set<string>,
  waiveReasons: Record<string, string> = {}
) {
  const activeChecks = hardeningData.checks.filter((c) => !ignoredIds.has(c.id));
  const stats = {
    total: activeChecks.length,
    pass: activeChecks.filter((c) => c.status === 'pass').length,
    warning: activeChecks.filter((c) => c.status === 'warning').length,
    fail: activeChecks.filter((c) => c.status === 'fail').length,
    manual: activeChecks.filter((c) => c.status === 'manual').length,
    info: activeChecks.filter((c) => c.status === 'info').length,
  };
  const waivedCount = hardeningData.checks.filter((c) => ignoredIds.has(c.id)).length;
  // Score over graded checks only (pass/warning/fail); manual + info are neutral.
  const graded = stats.pass + stats.warning + stats.fail;
  const denom = graded > 0 ? graded : 1;
  const pctPass = Math.round((stats.pass / denom) * 100);

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - 2 * PDF_MARGIN;

  let y = 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(26, 26, 26);
  doc.text('Security audit', PDF_MARGIN, y);
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated ${new Date().toLocaleString()}`, PDF_MARGIN, y);
  y += 6;
  if (waivedCount > 0) {
    doc.text(`${waivedCount} check(s) waived — excluded from the score below`, PDF_MARGIN, y);
    y += 5;
  }

  const summaryTop = y + 2;
  const summaryH = 26;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(232, 232, 228);
  doc.setLineWidth(0.3);
  doc.roundedRect(PDF_MARGIN, summaryTop, contentW, summaryH, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(26, 115, 232);
  doc.text(`${pctPass}%`, PDF_MARGIN + 4, summaryTop + 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  doc.text('of graded checks pass automated verification', PDF_MARGIN + 4, summaryTop + 17);

  const statParts = [
    `Pass ${stats.pass}`,
    `Warning ${stats.warning}`,
    `Fail ${stats.fail}`,
    `Info ${stats.info}`,
    `Manual ${stats.manual}`,
  ];
  doc.setFontSize(8);
  doc.setTextColor(60, 60, 60);
  const statsLine = statParts.join('   ·   ');
  doc.text(statsLine, PDF_MARGIN + 4, summaryTop + 22);

  const categories = orderedHardeningCategories(hardeningData.checks.map((c) => c.category));
  const checksByCat = new Map<string, HardeningCheck[]>();
  for (const c of hardeningData.checks) {
    const list = checksByCat.get(c.category) ?? [];
    list.push(c);
    checksByCat.set(c.category, list);
  }

  const body: unknown[] = [];
  for (const cat of categories) {
    const rows = checksByCat.get(cat);
    if (!rows?.length) continue;
    body.push([
      {
        content: cat,
        colSpan: PDF_COLS,
        styles: {
          fillColor: [245, 245, 243],
          fontStyle: 'bold',
          fontSize: 9,
          textColor: [26, 26, 26],
          cellPadding: { top: 3, bottom: 3, left: 2, right: 2 },
        },
      },
    ]);
    for (const c of rows) {
      const waived = ignoredIds.has(c.id);
      const desc = truncatePdfText(c.description, 220);
      const issues =
        c.issues && c.issues.length > 0
          ? `\nIssues: ${truncatePdfText(c.issues.join('; '), 180)}`
          : '';
      const reason = waived && waiveReasons[c.id]
        ? `\nWaive reason: ${truncatePdfText(waiveReasons[c.id], 180)}`
        : '';
      const checkCell = `${c.name}${waived ? '  [Waived]' : ''}\n${desc}${issues}${reason}`;
      body.push([
        checkCell,
        c.status.toUpperCase(),
        formatPdfValue(c.currentValue),
        formatPdfValue(c.recommendedValue),
        truncatePdfText(c.recommendation, 400),
      ]);
    }
  }

  const tableStartY = summaryTop + summaryH + 8;
  autoTable(doc, {
    head: [['Check', 'Status', 'Current', 'Recommended', 'Recommendation']],
    body: body as any,
    startY: tableStartY,
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
    styles: {
      fontSize: 7,
      cellPadding: 1.5,
      textColor: [26, 26, 26],
      lineColor: [232, 232, 228],
      lineWidth: 0.1,
      valign: 'top',
    },
    headStyles: {
      fillColor: [240, 240, 236],
      textColor: [80, 80, 80],
      fontStyle: 'bold',
      fontSize: 8,
    },
    columnStyles: {
      0: { cellWidth: 52 },
      1: { cellWidth: 22, halign: 'center' },
      2: { cellWidth: 28 },
      3: { cellWidth: 28 },
      4: { cellWidth: 'auto' as const },
    },
    showHead: 'everyPage',
    tableLineColor: [232, 232, 228],
    tableLineWidth: 0.1,
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const raw = data.row.raw as unknown[];
      if (!Array.isArray(raw) || raw.length < 2) return;
      const first = raw[0];
      if (first && typeof first === 'object' && first !== null && 'colSpan' in first) return;
      if (data.column.index !== 1) return;
      const s = String(data.cell.raw).toUpperCase();
      if (s === 'PASS') {
        data.cell.styles.fillColor = [236, 253, 245];
        data.cell.styles.textColor = [5, 150, 105];
      } else if (s === 'WARNING') {
        data.cell.styles.fillColor = [255, 251, 235];
        data.cell.styles.textColor = [180, 83, 9];
      } else if (s === 'FAIL') {
        data.cell.styles.fillColor = [254, 242, 242];
        data.cell.styles.textColor = [220, 38, 38];
      } else if (s === 'INFO') {
        data.cell.styles.fillColor = [239, 246, 255];
        data.cell.styles.textColor = [26, 115, 232];
      } else if (s === 'MANUAL') {
        data.cell.styles.fillColor = [245, 245, 243];
        data.cell.styles.textColor = [100, 100, 100];
      }
    },
  });

  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `GWS Security Audit · page ${p} of ${pageCount}`,
      PDF_MARGIN,
      doc.internal.pageSize.getHeight() - 8,
    );
  }

  doc.save(`gws-hardening-${new Date().toISOString().split('T')[0]}.pdf`);
}

const LU = 1.75;

const AUDIT_TABS = ['Overview', 'Passing', 'Failing', 'Ignored'] as const;

export function SecurityAudit() {
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hardeningData, setHardeningData] = useState<HardeningData | null>(null);
  const [exportAnchorEl, setExportAnchorEl] = useState<null | HTMLElement>(null);
  const [auditTab, setAuditTab] = useState(0);
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(loadIgnoredIdsFromStorage);
  const [waiveReasons, setWaiveReasons] = useState<Record<string, string>>(loadWaiveReasonsFromStorage);
  const [waiveDialog, setWaiveDialog] = useState<{ open: boolean; checkId: string | null; reason: string }>({ open: false, checkId: null, reason: '' });
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({ open: false, message: '', severity: 'success' });
  const showSnackbar = (message: string, severity: 'success' | 'error' | 'info' = 'success') => setSnackbar({ open: true, message, severity });

  const handleExportCSV = async () => {
    setExportAnchorEl(null);
    const filename = `gws-hardening-${new Date().toISOString().split('T')[0]}.csv`;
    try {
      const response = await apiClient.get('/audit/hardening/export', { responseType: 'blob' });
      if (response.status < 200 || response.status >= 300) {
        const text = await (response.data as Blob).text();
        let msg = 'Export failed.';
        try {
          const err = JSON.parse(text);
          if (err?.error) msg = err.error;
        } catch (_) {}
        showSnackbar(msg, 'error');
        return;
      }
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showSnackbar('CSV downloading now.');
    } catch (error: any) {
      console.error('Error exporting hardening checks:', error);
      const msg = error?.response?.data instanceof Blob
        ? 'Export failed. Check console or try again.'
        : getApiErrorMessage(error, 'Failed to export CSV.');
      showSnackbar(msg, 'error');
    }
  };

  const handleExportDrive = async () => {
    setExportAnchorEl(null);
    try {
      const response = await apiClient.post('/audit/hardening/export/drive');
      if (response.data?.webViewLink) window.open(response.data.webViewLink, '_blank');
      showSnackbar('Saved to Google Drive.');
    } catch (err: any) {
      console.error(err);
      showSnackbar(getApiErrorMessage(err, 'Drive export failed.'), 'error');
    }
  };

  const handleExportPDF = () => {
    setExportAnchorEl(null);
    if (!hardeningData) {
      showSnackbar('No data to export. Load the audit first.', 'info');
      return;
    }
    try {
      exportSecurityAuditToPdf(hardeningData, ignoredIds, waiveReasons);
      showSnackbar('PDF downloading now.');
    } catch (err: unknown) {
      console.error('Error exporting PDF:', err);
      const msg = err instanceof Error ? err.message : 'Failed to export PDF.';
      showSnackbar(msg, 'error');
    }
  };

  const fetchHardening = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/audit/hardening');
      setHardeningData(response.data);
      setLastRunAt(new Date());
      setLoadError(null);
    } catch (error) {
      console.error('Error fetching hardening checks:', error);
      setLoadError(getApiErrorMessage(error, 'Audit failed'));
    } finally {
      setLoading(false);
    }
  };

  const lastRunLabel = useMemo(() => {
    if (loading) return 'Running audit…';
    if (!lastRunAt) return 'Not run yet';
    return `Last run: ${lastRunAt.toLocaleString()}`;
  }, [loading, lastRunAt]);

  useEffect(() => {
    fetchHardening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hardeningData?.checks?.length) return;
    const valid = new Set(hardeningData.checks.map((c) => c.id));
    setIgnoredIds((prev) => {
      const next = new Set([...prev].filter((id) => valid.has(id)));
      if (next.size === prev.size) return prev;
      persistIgnoredIds(next);
      return next;
    });
    setWaiveReasons((prev) => {
      const entries = Object.entries(prev).filter(([id]) => valid.has(id));
      if (entries.length === Object.keys(prev).length) return prev;
      const next = Object.fromEntries(entries);
      persistWaiveReasons(next);
      return next;
    });
  }, [hardeningData]);

  // Open the waive dialog (also used to edit the reason on an already-waived check).
  const openWaiveDialog = useCallback((checkId: string) => {
    setWaiveDialog({ open: true, checkId, reason: waiveReasons[checkId] ?? '' });
  }, [waiveReasons]);

  const closeWaiveDialog = useCallback(() => {
    setWaiveDialog({ open: false, checkId: null, reason: '' });
  }, []);

  const confirmWaive = useCallback(() => {
    const checkId = waiveDialog.checkId;
    if (!checkId) return;
    const reason = waiveDialog.reason.trim();
    setIgnoredIds((prev) => {
      const next = new Set(prev);
      next.add(checkId);
      persistIgnoredIds(next);
      return next;
    });
    setWaiveReasons((prev) => {
      const next = { ...prev };
      if (reason) next[checkId] = reason;
      else delete next[checkId];
      persistWaiveReasons(next);
      return next;
    });
    closeWaiveDialog();
  }, [waiveDialog, closeWaiveDialog]);

  // Un-waive: track the check again and drop any saved reason.
  const untrackWaive = useCallback((checkId: string) => {
    setIgnoredIds((prev) => {
      const next = new Set(prev);
      next.delete(checkId);
      persistIgnoredIds(next);
      return next;
    });
    setWaiveReasons((prev) => {
      if (!(checkId in prev)) return prev;
      const next = { ...prev };
      delete next[checkId];
      persistWaiveReasons(next);
      return next;
    });
  }, []);

  const activeChecks = useMemo(() => {
    if (!hardeningData) return [];
    return hardeningData.checks.filter((c) => !ignoredIds.has(c.id));
  }, [hardeningData, ignoredIds]);

  const activeStats = useMemo(() => {
    return {
      total: activeChecks.length,
      pass: activeChecks.filter((c) => c.status === 'pass').length,
      warning: activeChecks.filter((c) => c.status === 'warning').length,
      fail: activeChecks.filter((c) => c.status === 'fail').length,
      manual: activeChecks.filter((c) => c.status === 'manual').length,
      info: activeChecks.filter((c) => c.status === 'info').length,
    };
  }, [activeChecks]);

  const passingChecks = useMemo(() => {
    if (!hardeningData) return [];
    return hardeningData.checks.filter((c) => c.status === 'pass' && !ignoredIds.has(c.id));
  }, [hardeningData, ignoredIds]);

  // "Failing" = actionable items only (warning/fail/manual). Info is neutral and
  // stays on the Overview, never in the fix-it list.
  const failingChecks = useMemo(() => {
    if (!hardeningData) return [];
    return hardeningData.checks.filter(
      (c) => (c.status === 'warning' || c.status === 'fail' || c.status === 'manual') && !ignoredIds.has(c.id)
    );
  }, [hardeningData, ignoredIds]);

  const ignoredChecks = useMemo(() => {
    if (!hardeningData) return [];
    return hardeningData.checks
      .filter((c) => ignoredIds.has(c.id))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [hardeningData, ignoredIds]);

  const ignoredCount = ignoredIds.size;

  const statusCell = (check: HardeningCheck, showWaivedBadge: boolean) => {
    const waived = ignoredIds.has(check.id);
    return (
      <Box sx={{ width: 100, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        <DotLabel
          dotColor={
            check.status === 'pass'
              ? T.success
              : check.status === 'warning'
                ? T.warning
                : check.status === 'fail'
                  ? T.danger
                  : check.status === 'info'
                    ? T.accent
                    : textTertiary(theme)
          }
          dotTooltip={check.status.toUpperCase()}
        >
          {check.status.toUpperCase()}
        </DotLabel>
        {showWaivedBadge && waived && (
          <DotLabel dotColor={textTertiary(theme)} dotTooltip="Excluded from compliance score">
            Waived
          </DotLabel>
        )}
      </Box>
    );
  };

  const actionCell = (check: HardeningCheck) => {
    const waived = ignoredIds.has(check.id);
    return (
      <Box sx={{ width: 188, flexShrink: 0, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        {check.adminConsoleUrl && (
          <Button
            size="small"
            variant="outlined"
            href={check.adminConsoleUrl}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem' }}
          >
            Configure
          </Button>
        )}
        {waived ? (
          <>
            <Tooltip title={check.recommendation ? 'Edit waive reason' : 'Add waive reason'}>
              <IconButton
                size="small"
                onClick={() => openWaiveDialog(check.id)}
                aria-label="Edit waive reason"
                sx={{ color: (t) => textSecondary(t) }}
              >
                <Pencil size={16} strokeWidth={1.75} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Track again — include in score">
              <IconButton
                size="small"
                onClick={() => untrackWaive(check.id)}
                aria-label="Track again"
                sx={{ color: (t) => textSecondary(t) }}
              >
                <RotateCcw size={16} strokeWidth={1.75} />
              </IconButton>
            </Tooltip>
          </>
        ) : (
          <Tooltip title="Waive — exclude from compliance score">
            <IconButton
              size="small"
              onClick={() => openWaiveDialog(check.id)}
              aria-label="Waive check"
              sx={{ color: (t) => textSecondary(t) }}
            >
              <EyeOff size={16} strokeWidth={1.75} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    );
  };

  // Single "Recommended" cell: the short target state on top, with the
  // actionable guidance beneath it (only when it adds detail). Replaces the
  // old redundant "Recommended" + "Recommendation" pair of columns.
  const recommendedBlock = (check: HardeningCheck) => {
    const target = check.recommendedValue != null ? String(check.recommendedValue).trim() : '';
    const guidance = (check.recommendation ?? '').trim();
    const showGuidance = guidance && guidance.toLowerCase() !== target.toLowerCase();
    return (
      <Box sx={{ minWidth: 0 }}>
        {target && (
          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 600, color: (th) => pick(th, T.text, '#fafafa') }}>
            {target}
          </Typography>
        )}
        {showGuidance && (
          <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textSecondary(t), mt: target ? 0.25 : 0 }}>
            {guidance}
          </Typography>
        )}
        {!target && !showGuidance && (
          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>—</Typography>
        )}
      </Box>
    );
  };

  const checkNameBlock = (check: HardeningCheck) => (
    <Box sx={{ minWidth: 0, pr: 1 }}>
      <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', fontWeight: 600, color: (th) => pick(th, T.text, '#fafafa') }}>{check.name}</Typography>
      <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textSecondary(t), display: 'block', mt: 0.25 }}>{check.description}</Typography>
      {check.issues && check.issues.length > 0 && (
        <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {check.issues.map((issue, i) => (
            <DotLabel key={i} dotColor={T.warning} dotTooltip={issue}>
              {issue}
            </DotLabel>
          ))}
        </Box>
      )}
      {ignoredIds.has(check.id) && waiveReasons[check.id] && (
        <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', fontStyle: 'italic', color: (t) => textTertiary(t), display: 'block', mt: 0.75 }}>
          Waive reason: {waiveReasons[check.id]}
        </Typography>
      )}
    </Box>
  );

  return (
    <>
    <Box sx={{ fontFamily: T.font, minHeight: '100vh' }}>
      <Box
        sx={{
          mb: 3,
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          gap: 2,
          alignItems: { md: 'center' },
          justifyContent: 'space-between',
        }}
      >
        <Typography sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.02em', color: (th) => pick(th, T.text, '#fafafa') }}>
          Security audit
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <SegmentedControl value={auditTab} options={[...AUDIT_TABS]} onChange={setAuditTab} />
          {!loading && hardeningData && (
          <>
            <Tooltip title="Export to CSV or Google Drive">
              <span>
                {isMdUp ? (
                  <Button
                    variant="outlined"
                    endIcon={<ChevronDown size={20} strokeWidth={LU} />}
                    onClick={(e) => setExportAnchorEl(e.currentTarget)}
                    sx={exportToolbarButtonSx()}
                  >
                    Export
                  </Button>
                ) : (
                  <IconButton
                    onClick={(e) => setExportAnchorEl(e.currentTarget)}
                    aria-label="Export"
                    sx={exportToolbarButtonSx()}
                  >
                    <ChevronDown size={20} strokeWidth={LU} />
                  </IconButton>
                )}
              </span>
            </Tooltip>
            <Menu
              anchorEl={exportAnchorEl}
              open={Boolean(exportAnchorEl)}
              onClose={() => setExportAnchorEl(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              PaperProps={{
                sx: (th) => ({
                  ...(typeof menuPaperProps.PaperProps.sx === 'function'
                    ? menuPaperProps.PaperProps.sx(th)
                    : {}),
                  ...(exportAnchorEl ? { minWidth: exportAnchorEl.offsetWidth } : {}),
                }),
              }}
              MenuListProps={{ dense: true, sx: { py: 0.5 } }}
            >
              <ExportMenuRow label="Export to CSV" icon={<Download size={16} strokeWidth={LU} />} onClick={handleExportCSV} />
              <ExportMenuRow label="Export to Drive" icon={<CloudUpload size={16} strokeWidth={LU} />} onClick={handleExportDrive} />
              <ExportMenuRow label="Export to PDF" icon={<FileText size={16} strokeWidth={LU} />} onClick={handleExportPDF} />
            </Menu>
          </>
          )}
        </Box>
      </Box>

      {/* Run controls: explicit run button + last-run note (mirrors the Drive audit) */}
      <Box sx={(th) => ({
        display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mb: 2,
        p: 1.5, borderRadius: T.radius, border: `1px solid ${pick(th, T.border, '#3f3f46')}`, bgcolor: pick(th, T.surface, '#27272a'),
      })}>
        <Button
          size="small"
          variant="contained"
          onClick={fetchHardening}
          disabled={loading}
          startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <Play size={15} strokeWidth={1.75} />}
          sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, fontSize: '0.8125rem', fontWeight: 500, height: 32, px: 2, bgcolor: T.accent, '&:hover': { bgcolor: T.accentHover } }}
        >
          {loading ? 'Running…' : 'Run audit'}
        </Button>
        <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>
          {lastRunLabel}
        </Typography>
      </Box>

      {loadError && !loading && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setLoadError(null)}>{loadError}</Alert>
      )}

      {loading ? (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      ) : hardeningData ? (
            <>
              {auditTab === 0 &&
                (() => {
                  const s = activeStats;
                  // Score over graded checks only (pass/warning/fail). Info + manual
                  // are neutral (org-dependent / not automatically verifiable).
                  const denom = s.pass + s.warning + s.fail;
                  const pctPass = denom === 0 ? 0 : Math.round((s.pass / denom) * 100);
                  const headlineColor = pctPass >= 80 ? T.success : pctPass >= 50 ? T.accent : T.warning;
                  return (
                    <Box
                      sx={(th) => ({
                        border: `1px solid ${pick(th, T.border, '#3f3f46')}`,
                        borderRadius: T.radiusLg,
                        p: 2.5,
                        mb: 3,
                        bgcolor: pick(th, T.surface, '#18181b'),
                      })}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 2 }}>
                        <Box>
                          <Typography sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '2rem', letterSpacing: '-0.03em', color: headlineColor, lineHeight: 1 }}>
                            {pctPass}%
                          </Typography>
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), mt: 0.5 }}>
                            of graded checks pass automated verification (info &amp; manual excluded)
                          </Typography>
                          {ignoredCount > 0 && (
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textTertiary(t), mt: 0.75 }}>
                              {ignoredCount} waived — excluded from this score.{' '}
                              <Box
                                component="button"
                                type="button"
                                onClick={() => setAuditTab(3)}
                                sx={{
                                  p: 0,
                                  border: 'none',
                                  background: 'none',
                                  cursor: 'pointer',
                                  font: 'inherit',
                                  color: T.accent,
                                  textDecoration: 'underline',
                                  '&:hover': { opacity: 0.9 },
                                }}
                              >
                                View waived
                              </Box>
                            </Typography>
                          )}
                        </Box>
                        <Box sx={{ display: 'flex', gap: 3, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <Box sx={{ textAlign: 'right' }}>
                            <Typography sx={{ fontFamily: T.font, fontSize: '1.25rem', fontWeight: 600, color: T.success }}>{s.pass}</Typography>
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.6875rem', color: (t) => textTertiary(t), textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pass</Typography>
                          </Box>
                          <Box sx={{ textAlign: 'right' }}>
                            <Typography sx={{ fontFamily: T.font, fontSize: '1.25rem', fontWeight: 600, color: T.warning }}>{s.warning}</Typography>
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.6875rem', color: (t) => textTertiary(t), textTransform: 'uppercase', letterSpacing: '0.06em' }}>Warning</Typography>
                          </Box>
                          <Box sx={{ textAlign: 'right' }}>
                            <Typography sx={{ fontFamily: T.font, fontSize: '1.25rem', fontWeight: 600, color: T.danger }}>{s.fail}</Typography>
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.6875rem', color: (t) => textTertiary(t), textTransform: 'uppercase', letterSpacing: '0.06em' }}>Fail</Typography>
                          </Box>
                          <Box sx={{ textAlign: 'right' }}>
                            <Typography sx={{ fontFamily: T.font, fontSize: '1.25rem', fontWeight: 600, color: T.accent }}>{s.info}</Typography>
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.6875rem', color: (t) => textTertiary(t), textTransform: 'uppercase', letterSpacing: '0.06em' }}>Info</Typography>
                          </Box>
                          <Box sx={{ textAlign: 'right' }}>
                            <Typography sx={{ fontFamily: T.font, fontSize: '1.25rem', fontWeight: 600, color: (t) => textTertiary(t) }}>{s.manual}</Typography>
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.6875rem', color: (t) => textTertiary(t), textTransform: 'uppercase', letterSpacing: '0.06em' }}>Manual</Typography>
                          </Box>
                        </Box>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={pctPass}
                        sx={(th) => ({
                          height: 6,
                          borderRadius: 3,
                          bgcolor: pick(th, '#e8e8e4', '#27272a'),
                          '& .MuiLinearProgress-bar': {
                            borderRadius: 3,
                            bgcolor: pctPass >= 80 ? T.success : pctPass >= 50 ? T.accent : T.warning,
                            transition: 'transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
                          },
                        })}
                      />
                    </Box>
                  );
                })()}

              {auditTab === 0 &&
                orderedHardeningCategories(hardeningData.checks.map((c) => c.category)).map((category) => {
                  const categoryChecks = hardeningData.checks.filter((c) => c.category === category);
                  if (categoryChecks.length === 0) return null;

                  return (
                    <Box key={category} sx={{ mb: 4 }}>
                      <Typography sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.02em', color: (th) => pick(th, T.text, '#fafafa'), mt: 3, mb: 2 }}>
                        {category}
                      </Typography>
                      <ListShell>
                        <ListHeaderRow>
                          <ColumnHeader label="Check" columnId="check" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width="26%" />
                          <ColumnHeader label="Status" columnId="st" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width={100} />
                          <ColumnHeader label="Current Value" columnId="cv" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width="16%" />
                          <ColumnHeader label="Recommended" columnId="rec" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} />
                          <ColumnHeader label="Action" columnId="act" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width={200} align="right" />
                        </ListHeaderRow>
                        {categoryChecks.map((check, idx) => {
                          const waived = ignoredIds.has(check.id);
                          return (
                            <Box
                              key={check.id}
                              sx={{
                                opacity: waived ? 0.72 : 1,
                              }}
                            >
                              <ListDataRow last={idx === categoryChecks.length - 1}>
                                <Box sx={{ width: '26%', minWidth: 0 }}>{checkNameBlock(check)}</Box>
                                {statusCell(check, true)}
                                <Box sx={{ width: '16%', minWidth: 0 }}>
                                  <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{String(check.currentValue ?? 'N/A')}</Typography>
                                </Box>
                                <Box sx={{ flex: 1, minWidth: 0 }}>{recommendedBlock(check)}</Box>
                                {actionCell(check)}
                              </ListDataRow>
                            </Box>
                          );
                        })}
                      </ListShell>
                    </Box>
                  );
                })}

              {auditTab === 1 && (
                <Box sx={{ mb: 3 }}>
                  {passingChecks.length === 0 ? (
                    <Box sx={{ py: 6, textAlign: 'center' }}>
                      <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>No passing checks in this view.</Typography>
                    </Box>
                  ) : (
                    <ListShell>
                      <ListHeaderRow>
                        <ColumnHeader label="Check" columnId="check" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width="20%" />
                        <ColumnHeader label="Category" columnId="cat" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width={120} />
                        <ColumnHeader label="Status" columnId="st" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width={100} />
                        <ColumnHeader label="Current Value" columnId="cv" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width="14%" />
                        <ColumnHeader label="Recommended" columnId="rec" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} />
                        <ColumnHeader label="Action" columnId="act" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width={200} align="right" />
                      </ListHeaderRow>
                      {passingChecks.map((check, idx) => (
                        <ListDataRow key={check.id} last={idx === passingChecks.length - 1}>
                          <Box sx={{ width: '20%', minWidth: 0 }}>{checkNameBlock(check)}</Box>
                          <Box sx={{ width: 120, flexShrink: 0 }}>
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{check.category}</Typography>
                          </Box>
                          {statusCell(check, false)}
                          <Box sx={{ width: '14%', minWidth: 0 }}>
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{String(check.currentValue ?? 'N/A')}</Typography>
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0 }}>{recommendedBlock(check)}</Box>
                          {actionCell(check)}
                        </ListDataRow>
                      ))}
                    </ListShell>
                  )}
                </Box>
              )}

              {auditTab === 2 && (
                <Box sx={{ mb: 3 }}>
                  {failingChecks.length === 0 ? (
                    <Box sx={{ py: 6, textAlign: 'center' }}>
                      <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>Nothing to fix — all remaining checks pass or are waived.</Typography>
                    </Box>
                  ) : (
                    <ListShell>
                      <ListHeaderRow>
                        <ColumnHeader label="Check" columnId="check" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width="20%" />
                        <ColumnHeader label="Category" columnId="cat" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width={120} />
                        <ColumnHeader label="Status" columnId="st" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width={100} />
                        <ColumnHeader label="Current Value" columnId="cv" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width="14%" />
                        <ColumnHeader label="Recommended" columnId="rec" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} />
                        <ColumnHeader label="Action" columnId="act" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width={200} align="right" />
                      </ListHeaderRow>
                      {failingChecks.map((check, idx) => (
                        <ListDataRow key={check.id} last={idx === failingChecks.length - 1}>
                          <Box sx={{ width: '20%', minWidth: 0 }}>{checkNameBlock(check)}</Box>
                          <Box sx={{ width: 120, flexShrink: 0 }}>
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{check.category}</Typography>
                          </Box>
                          {statusCell(check, false)}
                          <Box sx={{ width: '14%', minWidth: 0 }}>
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{String(check.currentValue ?? 'N/A')}</Typography>
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0 }}>{recommendedBlock(check)}</Box>
                          {actionCell(check)}
                        </ListDataRow>
                      ))}
                    </ListShell>
                  )}
                </Box>
              )}

              {auditTab === 3 && (
                <Box sx={{ mb: 3 }}>
                  {ignoredChecks.length === 0 ? (
                    <Box sx={{ py: 6, textAlign: 'center' }}>
                      <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>
                        No waived checks. Use <Box component="span" sx={{ fontWeight: 600 }}>Waive</Box> on a row to exclude it from your score.
                      </Typography>
                    </Box>
                  ) : (
                    <ListShell>
                      <ListHeaderRow>
                        <ColumnHeader label="Check" columnId="check" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width="20%" />
                        <ColumnHeader label="Category" columnId="cat" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width={120} />
                        <ColumnHeader label="Status" columnId="st" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width={100} />
                        <ColumnHeader label="Current Value" columnId="cv" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width="14%" />
                        <ColumnHeader label="Recommended" columnId="rec" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} />
                        <ColumnHeader label="Action" columnId="act" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width={200} align="right" />
                      </ListHeaderRow>
                      {ignoredChecks.map((check, idx) => (
                        <ListDataRow key={check.id} last={idx === ignoredChecks.length - 1}>
                          <Box sx={{ width: '20%', minWidth: 0 }}>{checkNameBlock(check)}</Box>
                          <Box sx={{ width: 120, flexShrink: 0 }}>
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{check.category}</Typography>
                          </Box>
                          {statusCell(check, true)}
                          <Box sx={{ width: '14%', minWidth: 0 }}>
                            <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>{String(check.currentValue ?? 'N/A')}</Typography>
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0 }}>{recommendedBlock(check)}</Box>
                          {actionCell(check)}
                        </ListDataRow>
                      ))}
                    </ListShell>
                  )}
                </Box>
              )}
            </>
          ) : null}
    </Box>
      <Dialog open={waiveDialog.open} onClose={closeWaiveDialog} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontFamily: T.font, fontWeight: 700 }}>
          {waiveDialog.checkId && ignoredIds.has(waiveDialog.checkId) ? 'Edit waive reason' : 'Waive check'}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), mb: 2 }}>
            Waived checks are excluded from the compliance score. Add a note so future audits capture why (optional).
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            maxRows={6}
            placeholder="e.g. Mail delegation required for shared support inbox — approved by IT, 2026-07"
            value={waiveDialog.reason}
            onChange={(e) => setWaiveDialog((d) => ({ ...d, reason: e.target.value }))}
            InputProps={{ sx: { fontFamily: T.font, fontSize: '0.875rem' } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeWaiveDialog} sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, color: (t) => textSecondary(t) }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={confirmWaive}
            sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius, bgcolor: T.accent, '&:hover': { bgcolor: T.accentHover } }}
          >
            {waiveDialog.checkId && ignoredIds.has(waiveDialog.checkId) ? 'Save reason' : 'Waive'}
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          severity={snackbar.severity}
          sx={{ width: '100%', fontFamily: T.font, borderRadius: T.radius, alignItems: 'center' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}
