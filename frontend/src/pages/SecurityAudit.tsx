import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Button,
  Menu,
  IconButton,
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
import { Download, CloudUpload, FileText, ChevronDown, ChevronRight, Play, EyeOff, RotateCcw, Pencil, ExternalLink, Shield, X } from 'lucide-react';
import { apiClient } from '../services/api.client';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import {
  T,
  pick,
  menuPaperProps,
  textSecondary,
  textTertiary,
  exportToolbarButtonSx,
  dialogPaperSx,
  dialogTitleSx,
  dialogActionsSx,
  dialogPrimaryButtonSx,
  dialogSecondaryButtonSx,
  dialogCancelButtonSx,
} from '../theme/designTokens';
import { ExportMenuRow } from '../components/ExportButton';
import { ActionTooltip } from '../components/ActionTooltip';
import { getApiErrorMessage } from '../utils/apiError';
import { ColumnHeader } from '../components/ui/ColumnHeader';
import { ListShell, ListHeaderRow, ListDataRow } from '../components/ui/ListShell';
import { DotLabel } from '../components/StatusDot';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { ScoreRing } from '../components/ui/ScoreRing';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { usePermissions } from '../hooks/usePermissions';
import { useResizableColumns } from '../hooks/useResizableColumns';

const STATIC_SORT = { key: '_', direction: 'asc' as const };
const noopSort = () => {};
const LU = 1.75;

/** Same section order as backend / GWS_HARDENING.md */
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

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

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

// --- Legacy browser storage (migration only) --------------------------------

const LEGACY_IGNORED_KEY = 'gws-hardening-ignored-ids';
const LEGACY_REASONS_KEY = 'gws-hardening-waive-reasons';
const LEGACY_MIGRATED_KEY = 'gws-hardening-waivers-migrated';

function loadLegacyLocalWaivers(): Record<string, string> {
  try {
    const idsRaw = localStorage.getItem(LEGACY_IGNORED_KEY);
    const reasonsRaw = localStorage.getItem(LEGACY_REASONS_KEY);
    const ids: string[] = idsRaw ? JSON.parse(idsRaw) : [];
    const reasons: Record<string, string> =
      reasonsRaw && typeof JSON.parse(reasonsRaw) === 'object' ? JSON.parse(reasonsRaw) : {};
    const out: Record<string, string> = {};
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === 'string') out[id] = typeof reasons[id] === 'string' ? reasons[id] : '';
      }
    }
    return out;
  } catch {
    return {};
  }
}

function clearLegacyLocalWaivers() {
  try {
    localStorage.removeItem(LEGACY_IGNORED_KEY);
    localStorage.removeItem(LEGACY_REASONS_KEY);
    localStorage.removeItem('gws-hardening-result');
  } catch {
    /* ignore */
  }
}

// --- Types ------------------------------------------------------------------

type Severity = 'critical' | 'high' | 'medium' | 'low';

interface HardeningCheck {
  id: string;
  category: string;
  name: string;
  description: string;
  status: 'pass' | 'warning' | 'fail' | 'manual' | 'info';
  source?: 'auto' | 'manual';
  severity?: Severity;
  currentValue?: unknown;
  recommendedValue?: unknown;
  rationale?: string;
  recommendation: string;
  adminConsoleUrl?: string;
  issues?: string[];
}

interface WaiverEntry {
  reason: string;
  waivedBy?: string;
  waivedAt?: string;
}

interface PolicyApiMeta {
  available: boolean;
  code?: string;
  message?: string;
}

interface HardeningPayload {
  status: 'never-run' | 'ready';
  ranAt: string | null;
  triggeredBy: string | null;
  durationMs: number | null;
  checks: HardeningCheck[];
  statistics: {
    total: number;
    pass: number;
    warning: number;
    fail: number;
    manual: number;
    info: number;
  };
  policyApi: PolicyApiMeta;
  waivers: Record<string, WaiverEntry>;
}

interface HardeningData {
  checks: HardeningCheck[];
  statistics: HardeningPayload['statistics'];
  policyApi?: PolicyApiMeta;
  ranAt?: string | null;
  triggeredBy?: string | null;
  durationMs?: number | null;
}

// --- PDF export -------------------------------------------------------------

const PDF_MARGIN = 14;
const PDF_COLS = 6;

function truncatePdfText(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatPdfValue(v: unknown): string {
  const s = String(v ?? '').trim();
  return s === '' ? '—' : s;
}

function exportSecurityAuditToPdf(
  hardeningData: HardeningData,
  ignoredIds: Set<string>,
  waiveReasons: Record<string, string> = {},
  meta?: { ranAt?: string | null; triggeredBy?: string | null }
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
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  const when = meta?.ranAt ? new Date(meta.ranAt).toLocaleString() : new Date().toLocaleString();
  doc.text(`Audit run: ${when}${meta?.triggeredBy ? ` · ${meta.triggeredBy}` : ''}`, PDF_MARGIN, y);
  y += 5;
  doc.text(`Exported ${new Date().toLocaleString()}`, PDF_MARGIN, y);
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
  doc.text(statParts.join('   ·   '), PDF_MARGIN + 4, summaryTop + 22);

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
      const rationale = c.rationale ? `\nWhy: ${truncatePdfText(c.rationale, 200)}` : '';
      const issues =
        c.issues && c.issues.length > 0
          ? `\nFindings: ${truncatePdfText(c.issues.join('; '), 160)}`
          : '';
      const reason =
        waived && waiveReasons[c.id]
          ? `\nWaive reason: ${truncatePdfText(waiveReasons[c.id], 160)}`
          : '';
      const checkCell = `${c.name}${waived ? '  [Waived]' : ''}\n${truncatePdfText(c.description, 180)}${rationale}${issues}${reason}`;
      const guidance = [c.recommendation, c.rationale && c.rationale !== c.recommendation ? '' : '']
        .filter(Boolean)
        .join(' ');
      body.push([
        checkCell,
        (c.severity || 'medium').toUpperCase(),
        c.status.toUpperCase(),
        formatPdfValue(c.currentValue),
        formatPdfValue(c.recommendedValue),
        truncatePdfText(c.recommendation || guidance, 360),
      ]);
    }
  }

  const tableStartY = summaryTop + summaryH + 8;
  autoTable(doc, {
    head: [['Check', 'Severity', 'Status', 'Current', 'Recommended', 'Guidance']],
    // jspdf-autotable accepts mixed cell objects for category headers
    body: body as unknown as string[][],
    startY: tableStartY,
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
    styles: {
      fontSize: 6.5,
      cellPadding: 1.3,
      textColor: [26, 26, 26],
      lineColor: [232, 232, 228],
      lineWidth: 0.1,
      valign: 'top',
    },
    headStyles: {
      fillColor: [240, 240, 236],
      textColor: [80, 80, 80],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    columnStyles: {
      0: { cellWidth: 48 },
      1: { cellWidth: 18, halign: 'center' },
      2: { cellWidth: 18, halign: 'center' },
      3: { cellWidth: 24 },
      4: { cellWidth: 24 },
      5: { cellWidth: 'auto' as const },
    },
    showHead: 'everyPage',
    tableLineColor: [232, 232, 228],
    tableLineWidth: 0.1,
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const raw = data.row.raw as unknown[];
      if (!Array.isArray(raw) || raw.length < 3) return;
      const first = raw[0];
      if (first && typeof first === 'object' && first !== null && 'colSpan' in first) return;
      if (data.column.index === 1) {
        const s = String(data.cell.raw).toUpperCase();
        if (s === 'CRITICAL') {
          data.cell.styles.fillColor = [254, 242, 242];
          data.cell.styles.textColor = [185, 28, 28];
        } else if (s === 'HIGH') {
          data.cell.styles.fillColor = [255, 247, 237];
          data.cell.styles.textColor = [194, 65, 12];
        } else if (s === 'MEDIUM') {
          data.cell.styles.fillColor = [255, 251, 235];
          data.cell.styles.textColor = [180, 83, 9];
        } else if (s === 'LOW') {
          data.cell.styles.fillColor = [245, 245, 243];
          data.cell.styles.textColor = [100, 100, 100];
        }
      }
      if (data.column.index === 2) {
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
      doc.internal.pageSize.getHeight() - 8
    );
  }

  doc.save(`gws-hardening-${new Date().toISOString().split('T')[0]}.pdf`);
}

const AUDIT_TABS = ['Overview', 'Passing', 'Failing', 'Waived'] as const;

function severityColor(sev: Severity | undefined): string {
  switch (sev) {
    case 'critical':
      return T.danger;
    case 'high':
      return '#c2410c';
    case 'medium':
      return T.warning;
    case 'low':
    default:
      return T.textTertiary;
  }
}

function applyPayload(
  data: HardeningPayload,
  setHardeningData: (d: HardeningData | null) => void,
  setWaivers: (w: Record<string, WaiverEntry>) => void,
  setLastRunAt: (d: Date | null) => void,
  setTriggeredBy: (s: string | null) => void
) {
  setWaivers(data.waivers || {});
  if (data.status === 'never-run' || !data.checks?.length) {
    setHardeningData(null);
    setLastRunAt(null);
    setTriggeredBy(null);
    return;
  }
  setHardeningData({
    checks: data.checks,
    statistics: data.statistics,
    policyApi: data.policyApi,
    ranAt: data.ranAt,
    triggeredBy: data.triggeredBy,
    durationMs: data.durationMs,
  });
  setLastRunAt(data.ranAt ? new Date(data.ranAt) : null);
  setTriggeredBy(data.triggeredBy);
}

// --- Component --------------------------------------------------------------

export function SecurityAudit() {
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const { isSuperAdmin, canTakeAction } = usePermissions();

  const auditCols = useResizableColumns(
    'security-audit-overview',
    { check: 240, severity: 100, status: 110, current: 200, recommended: 220 },
    { check: 140, severity: 80, status: 88, current: 120, recommended: 130 }
  );
  const auditListCols = useResizableColumns(
    'security-audit-list',
    { check: 200, category: 140, severity: 100, status: 110, current: 180, recommended: 200 },
    { check: 120, category: 100, severity: 80, status: 88, current: 120, recommended: 130 }
  );
  const waivedCols = useResizableColumns(
    'security-audit-waived',
    { check: 200, category: 140, severity: 100, reason: 260 },
    { check: 120, category: 100, severity: 80, reason: 140 }
  );

  const [bootLoading, setBootLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hardeningData, setHardeningData] = useState<HardeningData | null>(null);
  const [waivers, setWaivers] = useState<Record<string, WaiverEntry>>({});
  const [exportAnchorEl, setExportAnchorEl] = useState<null | HTMLElement>(null);
  const [auditTab, setAuditTab] = useState(0);
  const [detailCheckId, setDetailCheckId] = useState<string | null>(null);
  const [reasonEditing, setReasonEditing] = useState(false);
  const [reasonDraft, setReasonDraft] = useState('');
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);
  const [triggeredBy, setTriggeredBy] = useState<string | null>(null);
  const [waiveBusy, setWaiveBusy] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info';
  }>({ open: false, message: '', severity: 'success' });

  const showSnackbar = (message: string, severity: 'success' | 'error' | 'info' = 'success') =>
    setSnackbar({ open: true, message, severity });

  const ignoredIds = useMemo(() => new Set(Object.keys(waivers)), [waivers]);
  const waiveReasons = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [id, entry] of Object.entries(waivers)) {
      if (entry.reason) out[id] = entry.reason;
    }
    return out;
  }, [waivers]);

  const loadLatest = useCallback(async () => {
    const response = await apiClient.get<HardeningPayload>('/audit/hardening/latest');
    applyPayload(response.data, setHardeningData, setWaivers, setLastRunAt, setTriggeredBy);
    return response.data;
  }, []);

  // Boot: load cloud latest; optionally migrate browser-local waivers once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setBootLoading(true);
        const data = await loadLatest();
        if (cancelled) return;

        const cloudEmpty = !data.waivers || Object.keys(data.waivers).length === 0;
        const alreadyMigrated = sessionStorage.getItem(LEGACY_MIGRATED_KEY) === '1';
        const legacy = loadLegacyLocalWaivers();
        if (cloudEmpty && !alreadyMigrated && Object.keys(legacy).length > 0 && isSuperAdmin) {
          try {
            const imp = await apiClient.post('/audit/hardening/waivers/import', { waivers: legacy });
            sessionStorage.setItem(LEGACY_MIGRATED_KEY, '1');
            clearLegacyLocalWaivers();
            if (!cancelled && imp.data?.waivers) {
              setWaivers(imp.data.waivers);
              showSnackbar('Imported browser waivers to org storage.', 'info');
            }
          } catch {
            // Delegate or API failure — leave local alone for a super to import later.
          }
        }
        setLoadError(null);
      } catch (error) {
        if (!cancelled) {
          setLoadError(getApiErrorMessage(error, 'Failed to load security audit'));
        }
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadLatest, isSuperAdmin]);

  const runAudit = async () => {
    if (!canTakeAction) {
      showSnackbar('Only super admins can run the security audit.', 'info');
      return;
    }
    try {
      setRunning(true);
      setLoadError(null);
      const response = await apiClient.post<HardeningPayload>('/audit/hardening/run');
      applyPayload(response.data, setHardeningData, setWaivers, setLastRunAt, setTriggeredBy);
      showSnackbar('Audit complete — results saved for the organization.');
    } catch (error: unknown) {
      console.error('Error running hardening checks:', error);
      const ax = error as {
        response?: {
          status?: number;
          data?: {
            error?: string;
            code?: string;
            retryable?: boolean;
            previous?: HardeningPayload;
          };
        };
      };
      // Preflight blocked on Google rate limit / transient outage — keep last good
      // results on screen; do not replace with an empty or failed-looking state.
      if (ax?.response?.status === 503 && ax.response.data?.code === 'policy_api_rate_limited') {
        if (ax.response.data.previous) {
          applyPayload(
            ax.response.data.previous,
            setHardeningData,
            setWaivers,
            setLastRunAt,
            setTriggeredBy
          );
        }
        const msg =
          ax.response.data.error ||
          'Google is temporarily rate-limiting the Policy API. Your last audit was left unchanged — try again in a minute.';
        showSnackbar(msg, 'info');
        setLoadError(null);
        return;
      }
      setLoadError(getApiErrorMessage(error, 'Audit failed'));
    } finally {
      setRunning(false);
    }
  };

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
        } catch {
          /* ignore */
        }
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
    } catch (error: unknown) {
      console.error('Error exporting hardening checks:', error);
      const ax = error as { response?: { status?: number; data?: unknown } };
      if (ax?.response?.status === 404) {
        showSnackbar('No saved audit to export. Run the audit first.', 'info');
        return;
      }
      const msg =
        ax?.response?.data instanceof Blob
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
    } catch (err: unknown) {
      console.error(err);
      const ax = err as { response?: { status?: number } };
      if (ax?.response?.status === 404) {
        showSnackbar('No saved audit to export. Run the audit first.', 'info');
        return;
      }
      showSnackbar(getApiErrorMessage(err, 'Drive export failed.'), 'error');
    }
  };

  const handleExportPDF = () => {
    setExportAnchorEl(null);
    if (!hardeningData) {
      showSnackbar('No data to export. Run the audit first.', 'info');
      return;
    }
    try {
      exportSecurityAuditToPdf(hardeningData, ignoredIds, waiveReasons, {
        ranAt: hardeningData.ranAt ?? lastRunAt?.toISOString(),
        triggeredBy: hardeningData.triggeredBy ?? triggeredBy,
      });
      showSnackbar('PDF downloading now.');
    } catch (err: unknown) {
      console.error('Error exporting PDF:', err);
      const msg = err instanceof Error ? err.message : 'Failed to export PDF.';
      showSnackbar(msg, 'error');
    }
  };

  const lastRunAtLabel = useMemo(() => {
    if (!lastRunAt) return null;
    try {
      return lastRunAt.toLocaleString();
    } catch {
      return null;
    }
  }, [lastRunAt]);

  const openDetail = useCallback(
    (checkId: string) => {
      setDetailCheckId(checkId);
      setReasonEditing(false);
      setReasonDraft(waivers[checkId]?.reason ?? '');
    },
    [waivers]
  );

  const closeDetail = useCallback(() => {
    setDetailCheckId(null);
    setReasonEditing(false);
    setReasonDraft('');
  }, []);

  const applyWaive = useCallback(
    async (checkId: string, reason: string) => {
      if (!canTakeAction) {
        showSnackbar('Only super admins can change waivers.', 'info');
        return;
      }
      try {
        setWaiveBusy(true);
        const res = await apiClient.put(`/audit/hardening/waivers/${encodeURIComponent(checkId)}`, {
          reason: reason.trim(),
        });
        setWaivers(res.data.waivers || {});
        showSnackbar('Waiver saved for the organization.');
      } catch (err) {
        showSnackbar(getApiErrorMessage(err, 'Failed to save waiver.'), 'error');
      } finally {
        setWaiveBusy(false);
      }
    },
    [canTakeAction]
  );

  const untrackWaive = useCallback(
    async (checkId: string) => {
      if (!canTakeAction) {
        showSnackbar('Only super admins can change waivers.', 'info');
        return;
      }
      try {
        setWaiveBusy(true);
        const res = await apiClient.delete(`/audit/hardening/waivers/${encodeURIComponent(checkId)}`);
        setWaivers(res.data.waivers || {});
        showSnackbar('Check is tracked again.');
      } catch (err) {
        showSnackbar(getApiErrorMessage(err, 'Failed to remove waiver.'), 'error');
      } finally {
        setWaiveBusy(false);
      }
    },
    [canTakeAction]
  );

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

  const failingChecks = useMemo(() => {
    if (!hardeningData) return [];
    return hardeningData.checks
      .filter(
        (c) =>
          (c.status === 'warning' || c.status === 'fail' || c.status === 'manual') &&
          !ignoredIds.has(c.id)
      )
      .sort((a, b) => {
        const sa = SEVERITY_ORDER[a.severity || 'medium'] ?? 2;
        const sb = SEVERITY_ORDER[b.severity || 'medium'] ?? 2;
        if (sa !== sb) return sa - sb;
        const statusRank = (s: HardeningCheck['status']) =>
          s === 'fail' ? 0 : s === 'warning' ? 1 : 2;
        return statusRank(a.status) - statusRank(b.status);
      });
  }, [hardeningData, ignoredIds]);

  const ignoredChecks = useMemo(() => {
    if (!hardeningData) return [];
    const known = hardeningData.checks
      .filter((c) => ignoredIds.has(c.id))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    // Orphan waivers (catalog id no longer present) — keep visible
    const knownIds = new Set(hardeningData.checks.map((c) => c.id));
    const orphans: HardeningCheck[] = [...ignoredIds]
      .filter((id) => !knownIds.has(id))
      .map((id) => ({
        id,
        category: 'Waived (not in latest run)',
        name: id,
        description: 'This waiver outlived a catalog change or failed run. Review or remove.',
        status: 'info' as const,
        severity: 'low' as const,
        recommendation: 'Remove the waiver if the check no longer applies, or re-run the audit.',
        rationale: 'Durable waivers are retained even when a check id is missing from the latest snapshot.',
      }));
    return [...known, ...orphans];
  }, [hardeningData, ignoredIds]);

  const ignoredCount = ignoredIds.size;

  const statusCell = (check: HardeningCheck, showWaivedBadge: boolean) => {
    const waived = ignoredIds.has(check.id);
    return (
      <Box sx={{ ...auditCols.cellSx('status'), display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
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

  const severityCell = (check: HardeningCheck) => {
    const sev = check.severity || 'medium';
    return (
      <Box sx={auditCols.cellSx('severity')}>
        <DotLabel dotColor={severityColor(sev)} dotTooltip={`Severity: ${sev}`}>
          {sev.toUpperCase()}
        </DotLabel>
      </Box>
    );
  };

  const listStatusCell = (check: HardeningCheck) => {
    return (
      <Box sx={{ ...auditListCols.cellSx('status'), display: 'flex', alignItems: 'center', gap: 0.5 }}>
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
      </Box>
    );
  };

  const listSeverityCell = (check: HardeningCheck) => {
    const sev = check.severity || 'medium';
    return (
      <Box sx={auditListCols.cellSx('severity')}>
        <DotLabel dotColor={severityColor(sev)} dotTooltip={`Severity: ${sev}`}>
          {sev.toUpperCase()}
        </DotLabel>
      </Box>
    );
  };

  const recommendedTargetInline = (check: HardeningCheck) => {
    const target = check.recommendedValue != null ? String(check.recommendedValue).trim() : '';
    return (
      <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (th) => pick(th, T.text, '#fafafa') }}>
        {target || '—'}
      </Typography>
    );
  };

  const chevronCell = () => (
    <Box sx={{ width: 36, flex: '0 0 36px', ml: 'auto', display: 'flex', justifyContent: 'flex-end', color: (t) => textTertiary(t), lineHeight: 0 }}>
      <ChevronRight size={18} strokeWidth={1.75} />
    </Box>
  );

  const checkNameBlock = (check: HardeningCheck) => (
    <Box sx={{ minWidth: 0, pr: 1 }}>
      <Typography
        sx={{
          fontFamily: T.font,
          fontSize: '0.8125rem',
          fontWeight: 600,
          color: (th) => pick(th, T.text, '#fafafa'),
        }}
        noWrap
      >
        {check.name}
      </Typography>
    </Box>
  );

  const detailCheck =
    detailCheckId && hardeningData
      ? hardeningData.checks.find((c) => c.id === detailCheckId) ??
        ignoredChecks.find((c) => c.id === detailCheckId) ??
        null
      : detailCheckId
        ? ignoredChecks.find((c) => c.id === detailCheckId) ?? null
        : null;
  const detailWaived = detailCheck ? ignoredIds.has(detailCheck.id) : false;
  const detailStatusColor = (status: HardeningCheck['status']) =>
    status === 'pass'
      ? T.success
      : status === 'warning'
        ? T.warning
        : status === 'fail'
          ? T.danger
          : status === 'info'
            ? T.accent
            : textTertiary(theme);

  const policyBanner =
    hardeningData?.policyApi && !hardeningData.policyApi.available
      ? hardeningData.policyApi.message ||
        'Cloud Identity Policy API unavailable — policy-backed checks need manual review until access is restored.'
      : null;

  return (
    <>
      <Box sx={{ fontFamily: T.font }}>
        <PageHeader
          title="Security audit"
          lede={
            hardeningData
              ? 'Workspace hardening baseline for client reviews. Compliance score uses graded checks only (info, manual, and waived excluded).'
              : 'Workspace hardening baseline for client reviews. Run once to capture a snapshot you can export and discuss.'
          }
          status={
            running ? (
              <>
                <Box component="span" className="page-status-live">
                  Running now
                </Box>
                <Box component="span" className="page-status-faint">
                  {' '}
                  · Checking Google connectivity, then evaluating checks
                  {lastRunAtLabel ? ` · Previous: ${lastRunAtLabel}${triggeredBy ? ` · ${triggeredBy}` : ''}` : ''}
                </Box>
              </>
            ) : lastRunAtLabel ? (
              <>
                Last run: {lastRunAtLabel}
                {triggeredBy ? (
                  <Box component="span" className="page-status-faint">
                    {` · ${triggeredBy}`}
                  </Box>
                ) : null}
              </>
            ) : (
              <Box component="span" className="page-status-faint">
                Not run yet — results save to the organization after each run
              </Box>
            )
          }
          actions={
            <>
              <SegmentedControl value={auditTab} options={[...AUDIT_TABS]} onChange={setAuditTab} />
              <ActionTooltip title={canTakeAction ? 'Re-evaluate all checks and save for the organization' : 'Super admin only'}>
                <span>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={runAudit}
                    disabled={running || bootLoading || !canTakeAction}
                    startIcon={
                      running ? <CircularProgress size={14} color="inherit" /> : <Play size={15} strokeWidth={1.75} />
                    }
                    sx={{
                      fontFamily: T.font,
                      textTransform: 'none',
                      borderRadius: T.radius,
                      fontSize: '0.8125rem',
                      fontWeight: 500,
                      height: 32,
                      px: 2,
                      bgcolor: T.accent,
                      '&:hover': { bgcolor: T.accentHover },
                    }}
                  >
                    {running ? 'Running…' : 'Run audit'}
                  </Button>
                </span>
              </ActionTooltip>
              {!running && hardeningData && (
                <>
                  <ActionTooltip title="Export last saved audit (CSV, PDF, or Drive)">
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
                  </ActionTooltip>
                </>
              )}
            </>
          }
        />
        {!running && hardeningData && (
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
                  <ExportMenuRow
                    label="Export to CSV"
                    icon={<Download size={16} strokeWidth={LU} />}
                    onClick={handleExportCSV}
                  />
                  <ExportMenuRow
                    label="Export to Drive"
                    icon={<CloudUpload size={16} strokeWidth={LU} />}
                    onClick={handleExportDrive}
                  />
                  <ExportMenuRow
                    label="Export to PDF"
                    icon={<FileText size={16} strokeWidth={LU} />}
                    onClick={handleExportPDF}
                  />
                </Menu>
        )}

        {policyBanner && !running && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {policyBanner}
          </Alert>
        )}

        {loadError && !running && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setLoadError(null)}>
            {loadError}
          </Alert>
        )}

        {bootLoading || running ? (
          <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
            <CircularProgress />
          </Box>
        ) : hardeningData ? (
          <>
            {auditTab === 0 &&
              (() => {
                const s = activeStats;
                const denom = s.pass + s.warning + s.fail;
                const pctPass = denom === 0 ? 0 : Math.round((s.pass / denom) * 100);
                const headlineColor = pctPass >= 80 ? T.success : pctPass >= 50 ? T.accent : T.warning;
                const pctOfGraded = (n: number) => (denom === 0 ? 0 : Math.round((n / denom) * 100));
                return (
                  <Box
                    sx={(th) => ({
                      display: 'inline-flex',
                      flexDirection: 'column',
                      gap: 2,
                      border: `1px solid ${pick(th, T.border, '#3f3f46')}`,
                      borderRadius: T.radiusLg,
                      p: 2.25,
                      mb: 2.5,
                      bgcolor: pick(th, T.surface, '#18181b'),
                      maxWidth: '100%',
                    })}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: { xs: 2.5, sm: 3.5 },
                      }}
                    >
                      <ScoreRing
                        value={pctPass}
                        color={headlineColor}
                        caption="Compliance"
                        sizeVariant="lg"
                      />
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          flexWrap: 'wrap',
                          gap: { xs: 2, sm: 2.5 },
                        }}
                      >
                        <ScoreRing
                          value={pctOfGraded(s.pass)}
                          centerLabel={String(s.pass)}
                          color={T.success}
                          caption="Pass"
                          sizeVariant="sm"
                        />
                        <ScoreRing
                          value={pctOfGraded(s.warning)}
                          centerLabel={String(s.warning)}
                          color={T.warning}
                          caption="Warning"
                          sizeVariant="sm"
                        />
                        <ScoreRing
                          value={pctOfGraded(s.fail)}
                          centerLabel={String(s.fail)}
                          color={T.danger}
                          caption="Fail"
                          sizeVariant="sm"
                        />
                      </Box>
                      <Box
                        sx={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 1,
                          pl: { sm: 0.5 },
                          minWidth: 100,
                        }}
                      >
                        {(
                          [
                            ['Info', s.info, T.accent],
                            ['Manual', s.manual, textTertiary(theme)],
                          ] as const
                        ).map(([label, n, color]) => (
                          <Box key={label} sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                            <Typography sx={{ fontFamily: T.font, fontSize: '1.125rem', fontWeight: 600, color, minWidth: 28 }}>
                              {n}
                            </Typography>
                            <Typography
                              sx={{
                                fontFamily: T.font,
                                fontSize: '0.6875rem',
                                color: (t) => textTertiary(t),
                                textTransform: 'uppercase',
                                letterSpacing: '0.06em',
                              }}
                            >
                              {label}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                    <Box>
                      <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}>
                        Graded checks only — info and manual excluded from the compliance score.
                      </Typography>
                      {ignoredCount > 0 && (
                        <Typography
                          sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textTertiary(t), mt: 0.5 }}
                        >
                          {ignoredCount} waived — client-accepted risk, excluded from this score.{' '}
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
                  </Box>
                );
              })()}

            {auditTab === 0 &&
              orderedHardeningCategories(hardeningData.checks.map((c) => c.category)).map((category) => {
                const categoryChecks = hardeningData.checks.filter((c) => c.category === category);
                if (categoryChecks.length === 0) return null;

                return (
                  <Box key={category} sx={{ mb: 2.5 }}>
                    <Typography
                      sx={{
                        fontFamily: T.font,
                        fontWeight: 700,
                        fontSize: '1rem',
                        letterSpacing: '-0.02em',
                        color: (th) => pick(th, T.text, '#fafafa'),
                        mt: 1.5,
                        mb: 1,
                      }}
                    >
                      {category}
                    </Typography>
                    <ListShell>
                      <ListHeaderRow>
                        <ColumnHeader label="Check" columnId="check" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} {...auditCols.headerProps('check')} />
                        <ColumnHeader label="Severity" columnId="sev" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} {...auditCols.headerProps('severity')} />
                        <ColumnHeader label="Status" columnId="st" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} {...auditCols.headerProps('status')} />
                        <ColumnHeader label="Current" columnId="cv" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} {...auditCols.headerProps('current')} />
                        <ColumnHeader label="Recommended" columnId="rec" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} {...auditCols.headerProps('recommended')} />
                        <ColumnHeader label="" columnId="act" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width={36} align="right" pinEnd />
                      </ListHeaderRow>
                      {categoryChecks.map((check, idx) => {
                        const waived = ignoredIds.has(check.id);
                        return (
                          <Box key={check.id} sx={{ opacity: waived ? 0.72 : 1 }}>
                            <ListDataRow
                              last={idx === categoryChecks.length - 1}
                              onClick={() => openDetail(check.id)}
                            >
                              <Box sx={auditCols.cellSx('check')}>{checkNameBlock(check)}</Box>
                              {severityCell(check)}
                              {statusCell(check, true)}
                              <Box sx={auditCols.cellSx('current')}>
                                <Typography
                                  sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}
                                  noWrap
                                >
                                  {String(check.currentValue ?? 'N/A')}
                                </Typography>
                              </Box>
                              <Box sx={auditCols.cellSx('recommended')}>{recommendedTargetInline(check)}</Box>
                              {chevronCell()}
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
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>
                      No passing checks in this view.
                    </Typography>
                  </Box>
                ) : (
                  <ListShell>
                    <ListHeaderRow>
                      <ColumnHeader label="Check" columnId="check" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} {...auditListCols.headerProps('check')} />
                      <ColumnHeader label="Category" columnId="cat" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} {...auditListCols.headerProps('category')} />
                      <ColumnHeader label="Severity" columnId="sev" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} {...auditListCols.headerProps('severity')} />
                      <ColumnHeader label="Status" columnId="st" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} {...auditListCols.headerProps('status')} />
                      <ColumnHeader label="Current" columnId="cv" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} {...auditListCols.headerProps('current')} />
                      <ColumnHeader label="Recommended" columnId="rec" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} {...auditListCols.headerProps('recommended')} />
                      <ColumnHeader label="" columnId="act" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width={36} align="right" />
                    </ListHeaderRow>
                    {passingChecks.map((check, idx) => (
                      <ListDataRow key={check.id} last={idx === passingChecks.length - 1} onClick={() => openDetail(check.id)}>
                        <Box sx={auditListCols.cellSx('check')}>{checkNameBlock(check)}</Box>
                        <Box sx={auditListCols.cellSx('category')}>
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }} noWrap>
                            {check.category}
                          </Typography>
                        </Box>
                        {listSeverityCell(check)}
                        {listStatusCell(check)}
                        <Box sx={auditListCols.cellSx('current')}>
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }} noWrap>
                            {String(check.currentValue ?? 'N/A')}
                          </Typography>
                        </Box>
                        <Box sx={auditListCols.cellSx('recommended')}>{recommendedTargetInline(check)}</Box>
                        {chevronCell()}
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
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.9375rem', color: (t) => textSecondary(t) }}>
                      Nothing to fix — all remaining checks pass or are waived.
                    </Typography>
                  </Box>
                ) : (
                  <ListShell>
                    <ListHeaderRow>
                      <ColumnHeader label="Check" columnId="check" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} {...auditListCols.headerProps('check')} />
                      <ColumnHeader label="Category" columnId="cat" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} {...auditListCols.headerProps('category')} />
                      <ColumnHeader label="Severity" columnId="sev" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} {...auditListCols.headerProps('severity')} />
                      <ColumnHeader label="Status" columnId="st" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} {...auditListCols.headerProps('status')} />
                      <ColumnHeader label="Current" columnId="cv" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} {...auditListCols.headerProps('current')} />
                      <ColumnHeader label="Recommended" columnId="rec" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} {...auditListCols.headerProps('recommended')} />
                      <ColumnHeader label="" columnId="act" sortConfig={STATIC_SORT} onSort={noopSort} sortable={false} width={36} align="right" />
                    </ListHeaderRow>
                    {failingChecks.map((check, idx) => (
                      <ListDataRow key={check.id} last={idx === failingChecks.length - 1} onClick={() => openDetail(check.id)}>
                        <Box sx={auditListCols.cellSx('check')}>{checkNameBlock(check)}</Box>
                        <Box sx={auditListCols.cellSx('category')}>
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }} noWrap>
                            {check.category}
                          </Typography>
                        </Box>
                        {listSeverityCell(check)}
                        {listStatusCell(check)}
                        <Box sx={auditListCols.cellSx('current')}>
                          <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }} noWrap>
                            {String(check.currentValue ?? 'N/A')}
                          </Typography>
                        </Box>
                        <Box sx={auditListCols.cellSx('recommended')}>{recommendedTargetInline(check)}</Box>
                        {chevronCell()}
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
                      No waived checks. Use <Box component="span" sx={{ fontWeight: 600 }}>Waive</Box> on a finding to
                      record client-accepted risk (survives re-runs).
                    </Typography>
                  </Box>
                ) : (
                  <ListShell>
                    <ListHeaderRow>
                      <ColumnHeader
                        label="Check"
                        columnId="check"
                        sortConfig={STATIC_SORT}
                        onSort={noopSort}
                        sortable={false}
                        {...waivedCols.headerProps('check')}
                      />
                      <ColumnHeader
                        label="Category"
                        columnId="cat"
                        sortConfig={STATIC_SORT}
                        onSort={noopSort}
                        sortable={false}
                        {...waivedCols.headerProps('category')}
                      />
                      <ColumnHeader
                        label="Severity"
                        columnId="sev"
                        sortConfig={STATIC_SORT}
                        onSort={noopSort}
                        sortable={false}
                        {...waivedCols.headerProps('severity')}
                      />
                      <ColumnHeader
                        label="Reason"
                        columnId="reason"
                        sortConfig={STATIC_SORT}
                        onSort={noopSort}
                        sortable={false}
                        {...waivedCols.headerProps('reason')}
                      />
                      <ColumnHeader
                        label=""
                        columnId="act"
                        sortConfig={STATIC_SORT}
                        onSort={noopSort}
                        sortable={false}
                        width={40}
                        align="right"
                        pinEnd
                      />
                    </ListHeaderRow>
                    {ignoredChecks.map((check, idx) => {
                      const sev = check.severity || 'medium';
                      return (
                      <ListDataRow key={check.id} last={idx === ignoredChecks.length - 1} onClick={() => openDetail(check.id)}>
                        <Box sx={waivedCols.cellSx('check')}>{checkNameBlock(check)}</Box>
                        <Box sx={waivedCols.cellSx('category')}>
                          <Typography
                            sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t) }}
                            noWrap
                          >
                            {check.category}
                          </Typography>
                        </Box>
                        <Box sx={waivedCols.cellSx('severity')}>
                          <DotLabel dotColor={severityColor(sev)} dotTooltip={`Severity: ${sev}`}>
                            {sev.toUpperCase()}
                          </DotLabel>
                        </Box>
                        <Box sx={waivedCols.cellSx('reason')}>
                          <Typography
                            sx={{
                              fontFamily: T.font,
                              fontSize: '0.8125rem',
                              fontStyle: waiveReasons[check.id] ? 'italic' : 'normal',
                              color: (t) => textSecondary(t),
                            }}
                            noWrap
                          >
                            {waiveReasons[check.id] || 'No reason recorded'}
                          </Typography>
                        </Box>
                        {chevronCell()}
                      </ListDataRow>
                      );
                    })}
                  </ListShell>
                )}
              </Box>
            )}
          </>
        ) : (
          <EmptyState
            icon={<Shield size={22} strokeWidth={1.75} />}
            title="No audit snapshot yet"
            description="Evaluate the hardening baseline against this Workspace. You’ll get a compliance score, exportable findings, and a record of when it last ran."
            actions={
              <ActionTooltip title={canTakeAction ? 'Run first audit' : 'Super admin only'}>
                <span>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={runAudit}
                    disabled={running || !canTakeAction}
                    startIcon={<Play size={15} strokeWidth={1.75} />}
                    sx={{
                      fontFamily: T.font,
                      textTransform: 'none',
                      borderRadius: T.radius,
                      fontSize: '0.8125rem',
                      fontWeight: 500,
                      height: 32,
                      px: 2,
                      bgcolor: T.accent,
                      '&:hover': { bgcolor: T.accentHover },
                    }}
                  >
                    Run first audit
                  </Button>
                </span>
              </ActionTooltip>
            }
            hint="Usually finishes in under a minute · Super admin only"
          />
        )}
      </Box>

      <Dialog
        open={Boolean(detailCheck)}
        onClose={closeDetail}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: (th) => dialogPaperSx(th) }}
      >
        {detailCheck && (
          <>
            <DialogTitle sx={(th) => ({ ...dialogTitleSx(th), display: 'flex', alignItems: 'flex-start', gap: 1.5, pr: 1 })}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ fontFamily: T.font, fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.02em' }}>
                  {detailCheck.name}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                  <DotLabel
                    dotColor={severityColor(detailCheck.severity)}
                    dotTooltip={`Severity: ${detailCheck.severity || 'medium'}`}
                  >
                    {(detailCheck.severity || 'medium').toUpperCase()}
                  </DotLabel>
                  <DotLabel
                    dotColor={detailStatusColor(detailCheck.status)}
                    dotTooltip={detailCheck.status.toUpperCase()}
                  >
                    {detailCheck.status.toUpperCase()}
                  </DotLabel>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textTertiary(t) }}>
                    {detailCheck.category}
                  </Typography>
                  {detailCheck.source === 'manual' && (
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textTertiary(t) }}>
                      · Manual review
                    </Typography>
                  )}
                  {detailWaived && (
                    <DotLabel dotColor={textTertiary(theme)} dotTooltip="Excluded from compliance score">
                      Waived
                    </DotLabel>
                  )}
                </Box>
              </Box>
              <IconButton size="small" onClick={closeDetail} aria-label="Close" sx={{ color: (t) => textTertiary(t), mt: -0.5 }}>
                <X size={16} strokeWidth={1.75} />
              </IconButton>
            </DialogTitle>
            <DialogContent sx={{ pt: '20px !important' }}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                  gap: 1.75,
                  mb: 2.25,
                }}
              >
                <Box
                  sx={(th) => ({
                    p: 1.5,
                    borderRadius: T.radius,
                    bgcolor: pick(th, T.bg, '#111114'),
                    border: `1px solid ${pick(th, T.border, '#3f3f46')}`,
                  })}
                >
                  <Typography
                    sx={{
                      fontFamily: T.font,
                      fontSize: '0.6875rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: (t) => textTertiary(t),
                      mb: 0.75,
                    }}
                  >
                    Current value
                  </Typography>
                  <Typography
                    sx={{
                      fontFamily: T.font,
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: (th) => pick(th, T.text, '#fafafa'),
                    }}
                  >
                    {String(detailCheck.currentValue ?? 'N/A')}
                  </Typography>
                </Box>
                <Box
                  sx={(th) => ({
                    p: 1.5,
                    borderRadius: T.radius,
                    bgcolor: pick(th, T.bg, '#111114'),
                    border: `1px solid ${pick(th, T.border, '#3f3f46')}`,
                  })}
                >
                  <Typography
                    sx={{
                      fontFamily: T.font,
                      fontSize: '0.6875rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: (t) => textTertiary(t),
                      mb: 0.75,
                    }}
                  >
                    Recommended
                  </Typography>
                  <Typography
                    sx={{
                      fontFamily: T.font,
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: (th) => pick(th, T.text, '#fafafa'),
                    }}
                  >
                    {detailCheck.recommendedValue != null && String(detailCheck.recommendedValue).trim()
                      ? String(detailCheck.recommendedValue)
                      : '—'}
                  </Typography>
                </Box>
              </Box>

              {detailCheck.description && (
                <Typography sx={{ fontFamily: T.font, fontSize: '0.875rem', color: (t) => textSecondary(t), mb: 2.5 }}>
                  {detailCheck.description}
                </Typography>
              )}

              {detailCheck.rationale && (
                <Box sx={{ mb: 2.5 }}>
                  <Typography
                    sx={{
                      fontFamily: T.font,
                      fontSize: '0.6875rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: (t) => textTertiary(t),
                      mb: 0.5,
                    }}
                  >
                    Why this matters
                  </Typography>
                  <Typography sx={{ fontFamily: T.font, fontSize: '0.875rem', color: (t) => textSecondary(t) }}>
                    {detailCheck.rationale}
                  </Typography>
                </Box>
              )}

              {(() => {
                const guidance = (detailCheck.recommendation ?? '').trim();
                if (!guidance) return null;
                return (
                  <Box sx={{ mb: 2.5 }}>
                    <Typography
                      sx={{
                        fontFamily: T.font,
                        fontSize: '0.6875rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: (t) => textTertiary(t),
                        mb: 0.5,
                      }}
                    >
                      Recommendation
                    </Typography>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.875rem', color: (t) => textSecondary(t) }}>
                      {guidance}
                    </Typography>
                  </Box>
                );
              })()}

              {detailCheck.issues && detailCheck.issues.length > 0 && (
                <Box sx={{ mb: 2.5 }}>
                  <Typography
                    sx={{
                      fontFamily: T.font,
                      fontSize: '0.6875rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: (t) => textTertiary(t),
                      mb: 0.75,
                    }}
                  >
                    Findings
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                    {detailCheck.issues.map((issue, i) => (
                      <DotLabel key={i} dotColor={T.warning} dotTooltip={issue}>
                        {issue}
                      </DotLabel>
                    ))}
                  </Box>
                </Box>
              )}

              <Box
                sx={(th) => ({
                  mt: 1,
                  pt: 2,
                  borderTop: `1px solid ${pick(th, T.borderSubtle, '#27272a')}`,
                })}
              >
                {detailWaived && !reasonEditing ? (
                  <Box>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), mb: 0.5 }}>
                      Waived — client-accepted risk, excluded from the compliance score. Survives re-runs.
                    </Typography>
                    <Typography
                      sx={{
                        fontFamily: T.font,
                        fontSize: '0.8125rem',
                        fontStyle: waiveReasons[detailCheck.id] ? 'italic' : 'normal',
                        color: (t) => textTertiary(t),
                        mb: 0.5,
                      }}
                    >
                      {waiveReasons[detailCheck.id]
                        ? `Reason: ${waiveReasons[detailCheck.id]}`
                        : 'No reason recorded.'}
                    </Typography>
                    {waivers[detailCheck.id]?.waivedBy && (
                      <Typography
                        sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textTertiary(t), mb: 1.5 }}
                      >
                        By {waivers[detailCheck.id].waivedBy}
                        {waivers[detailCheck.id].waivedAt
                          ? ` · ${new Date(waivers[detailCheck.id].waivedAt!).toLocaleString()}`
                          : ''}
                      </Typography>
                    )}
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={!canTakeAction || waiveBusy}
                        startIcon={<Pencil size={15} strokeWidth={1.75} />}
                        onClick={() => {
                          setReasonDraft(waiveReasons[detailCheck.id] ?? '');
                          setReasonEditing(true);
                        }}
                        sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius }}
                      >
                        {waiveReasons[detailCheck.id] ? 'Edit reason' : 'Add reason'}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={!canTakeAction || waiveBusy}
                        startIcon={<RotateCcw size={15} strokeWidth={1.75} />}
                        onClick={() => untrackWaive(detailCheck.id)}
                        sx={{ fontFamily: T.font, textTransform: 'none', borderRadius: T.radius }}
                      >
                        Track again
                      </Button>
                    </Box>
                  </Box>
                ) : reasonEditing ? (
                  <Box>
                    <Typography sx={{ fontFamily: T.font, fontSize: '0.8125rem', color: (t) => textSecondary(t), mb: 1 }}>
                      Record why this finding is accepted (shown in exports and to other admins).
                    </Typography>
                    <TextField
                      autoFocus
                      fullWidth
                      multiline
                      minRows={2}
                      size="small"
                      placeholder="e.g. Client accepted residual risk — partner domain allowlist required for ops"
                      value={reasonDraft}
                      onChange={(e) => setReasonDraft(e.target.value)}
                      sx={{ mb: 1.5, fontFamily: T.font }}
                    />
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button
                        size="small"
                        variant="contained"
                        disabled={waiveBusy}
                        onClick={async () => {
                          await applyWaive(detailCheck.id, reasonDraft);
                          setReasonEditing(false);
                        }}
                        sx={(th) => dialogPrimaryButtonSx(th)}
                      >
                        Save waiver
                      </Button>
                      <Button
                        size="small"
                        disabled={waiveBusy}
                        onClick={() => setReasonEditing(false)}
                        sx={(th) => dialogCancelButtonSx(th)}
                      >
                        Cancel
                      </Button>
                    </Box>
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button
                      size="small"
                      disabled={!canTakeAction || waiveBusy}
                      startIcon={<EyeOff size={15} strokeWidth={1.75} />}
                      onClick={() => {
                        setReasonDraft('');
                        setReasonEditing(true);
                      }}
                      sx={(th) => dialogSecondaryButtonSx(th)}
                    >
                      Waive
                    </Button>
                  </Box>
                )}
              </Box>
            </DialogContent>
            <DialogActions sx={(th) => dialogActionsSx(th)}>
              {detailCheck.adminConsoleUrl && (
                <Button
                  size="small"
                  startIcon={<ExternalLink size={15} strokeWidth={1.75} />}
                  href={detailCheck.adminConsoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={(th) => dialogSecondaryButtonSx(th)}
                >
                  Open Admin guide
                </Button>
              )}
              <Box sx={{ flex: 1 }} />
              <Button onClick={closeDetail} sx={(th) => dialogCancelButtonSx(th)}>
                Close
              </Button>
              {reasonEditing && (
                <Button
                  size="small"
                  variant="contained"
                  disabled={waiveBusy || !canTakeAction}
                  onClick={async () => {
                    await applyWaive(detailCheck.id, reasonDraft);
                    setReasonEditing(false);
                  }}
                  sx={(th) => dialogPrimaryButtonSx(th)}
                >
                  Save waiver
                </Button>
              )}
            </DialogActions>
          </>
        )}
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
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}
