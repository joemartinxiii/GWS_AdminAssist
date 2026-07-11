import { Box } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { T, pick } from '../../theme/designTokens';

/** Outer bordered container for flex-based data lists */
export function listShellSx(theme: Theme) {
  return {
    border: `1px solid ${pick(theme, T.border, '#3f3f46')}`,
    borderRadius: T.radiusLg,
    // Horizontal scroll (rather than squeezing columns unreadably) when the
    // viewport is too narrow to fit every column at its minimum width.
    overflowX: 'auto' as const,
    overflowY: 'hidden' as const,
    bgcolor: pick(theme, T.surface, '#18181b'),
  };
}

export function ListShell({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={(theme: Theme) => listShellSx(theme)}>{children}</Box>
  );
}

/** Header strip under the top border */
export function ListHeaderRow({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={(theme: Theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: 1,
        borderBottom: `1px solid ${pick(theme, T.borderSubtle, '#27272a')}`,
        width: '100%',
        boxSizing: 'border-box',
        minWidth: 0,
      })}
    >
      {children}
    </Box>
  );
}

/** One data row with bottom divider */
export function ListDataRow({
  children,
  last,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  last?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <Box
      onClick={onClick}
      sx={(theme: Theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: 0.875,
        borderBottom: last ? 'none' : `1px solid ${pick(theme, T.borderSubtle, '#27272a')}`,
        cursor: onClick ? 'pointer' : 'default',
        width: '100%',
        boxSizing: 'border-box',
        minWidth: 0,
        bgcolor: selected ? pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.16)') : 'transparent',
        '&:hover': {
          bgcolor: selected
            ? pick(theme, T.accentSoft, 'rgba(26, 115, 232, 0.16)')
            : pick(theme, T.surfaceHover, '#27272a'),
        },
      })}
    >
      {children}
    </Box>
  );
}

/**
 * Trailing actions cell — always sits on the far right of a flex list row.
 * Use the same width on the matching ColumnHeader (align="right").
 */
export const listActionsSx = {
  width: 80,
  minWidth: 80,
  flexShrink: 0,
  ml: 'auto',
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 0.25,
} as const;

/** Primary text column that absorbs leftover row width. */
export const listPrimaryColSx = {
  flex: '1 1 0',
  minWidth: 120,
  overflow: 'hidden',
} as const;
