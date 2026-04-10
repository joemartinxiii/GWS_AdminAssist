import type { SxProps, Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';

/**
 * Shared design tokens for the app UI.
 * See docs/ui.md
 */
export const T = {
  bg: '#fafaf8',
  surface: '#ffffff',
  surfaceHover: '#f5f5f3',
  border: '#e8e8e4',
  borderSubtle: '#f0f0ec',
  text: '#1a1a1a',
  textSecondary: '#71717a',
  textTertiary: '#a1a1aa',
  accent: '#1a73e8',
  accentSoft: '#e8f0fe',
  accentBorder: '#aecbfa',
  accentHover: '#1557b0',
  success: '#059669',
  successSoft: '#ecfdf5',
  warning: '#d97706',
  warningSoft: '#fffbeb',
  danger: '#dc2626',
  dangerSoft: '#fef2f2',
  radius: '8px',
  radiusSm: '6px',
  radiusLg: '12px',
  font: '"Plus Jakarta Sans", "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", "Fira Code", "SF Mono", monospace',
  shadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)',
  shadowLg: '0 4px 12px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
} as const;

/** Brighter secondary/tertiary copy for dark surfaces (e.g. #18181b); use via textSecondary / textTertiary helpers */
export const TDark = {
  textSecondary: '#d4d4d8',
  textTertiary: '#b4b4bc',
} as const;

export const dark = (theme: Theme) => theme.palette.mode === 'dark';

export const pick = (theme: Theme, light: string, darkVal: string) => (dark(theme) ? darkVal : light);

export function textSecondary(theme: Theme) {
  return pick(theme, T.textSecondary, TDark.textSecondary);
}

export function textTertiary(theme: Theme) {
  return pick(theme, T.textTertiary, TDark.textTertiary);
}

/** `triggerSx` for `<ExportButton />` — matches Users page toolbar (outlined look, accent hover). */
export function exportToolbarButtonSx(): (theme: Theme) => SystemStyleObject<Theme> {
  return (th) => ({
    fontFamily: T.font,
    fontSize: '0.8125rem',
    fontWeight: 500,
    textTransform: 'none',
    borderRadius: T.radius,
    borderColor: pick(th, T.border, '#5f6368'),
    color: pick(th, T.text, '#e8eaed'),
    '&:hover': {
      borderColor: pick(th, T.accent, '#8ab4f8'),
      bgcolor: pick(th, T.accentSoft, 'rgba(26, 115, 232, 0.12)'),
    },
    '&.Mui-disabled': {
      borderColor: pick(th, T.border, '#3f3f46'),
      color: textTertiary(th),
    },
  });
}

/** Icon color for page toolbars (light: grey[700], dark: white) */
export function toolbarIconColor(theme: Theme): string {
  return theme.palette.mode === 'dark' ? '#fff' : theme.palette.grey[700];
}

/** Toolbar row: style icon buttons except the Filters control */
export const sxToolbarIconButtons: SxProps<Theme> = {
  '& .MuiIconButton-root:not([aria-label="Filters"])': { color: toolbarIconColor },
};

/** Toolbar row: style all icon buttons (no separate Filters button) */
export const sxToolbarAllIconButtons: SxProps<Theme> = {
  '& .MuiIconButton-root': { color: toolbarIconColor },
};

/** MUI `Select` dropdown Paper — same surface treatment as export menus */
export const selectMenuProps: { PaperProps: { sx: SxProps<Theme> } } = {
  PaperProps: {
    sx: (theme) => ({
      mt: 0.5,
      borderRadius: T.radius,
      border: `1px solid ${pick(theme, T.border, '#3f3f46')}`,
      bgcolor: pick(theme, T.surface, '#18181b'),
      boxShadow: dark(theme) ? '0 4px 20px rgba(0, 0, 0, 0.35)' : T.shadowLg,
      backgroundImage: 'none',
      '& .MuiMenuItem-root': {
        fontFamily: T.font,
        fontSize: '0.8125rem',
      },
    }),
  },
};

/** MUI `Menu` Paper: matches list/shell surfaces (not default gray dark paper). */
export const menuPaperProps: { PaperProps: { sx: SxProps<Theme> } } = {
  PaperProps: {
    sx: (theme) => ({
      mt: 0.5,
      borderRadius: T.radius,
      border: `1px solid ${pick(theme, T.border, '#3f3f46')}`,
      bgcolor: pick(theme, T.surface, '#18181b'),
      boxShadow: dark(theme) ? '0 4px 20px rgba(0, 0, 0, 0.35)' : T.shadowLg,
      backgroundImage: 'none',
      '& .MuiMenuItem-root': {
        fontFamily: T.font,
        fontSize: '0.8125rem',
      },
      '& .MuiListItemText-primary': {
        fontFamily: T.font,
        fontSize: '0.8125rem',
      },
    }),
  },
};
