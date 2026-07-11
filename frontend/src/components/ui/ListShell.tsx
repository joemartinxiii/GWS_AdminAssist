import { Box } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { T, pick } from '../../theme/designTokens';

/** Outer bordered container for flex-based data lists */
export function listShellSx(theme: Theme) {
  return {
    border: `1px solid ${pick(theme, T.border, '#3f3f46')}`,
    borderRadius: T.radiusLg,
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

const rowBase = {
  display: 'flex',
  alignItems: 'center',
  gap: 1.25,
  px: 2,
  width: '100%',
  boxSizing: 'border-box' as const,
  minWidth: 0,
};

/** Header strip under the top border */
export function ListHeaderRow({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={(theme: Theme) => ({
        ...rowBase,
        py: 1,
        borderBottom: `1px solid ${pick(theme, T.borderSubtle, '#27272a')}`,
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
        ...rowBase,
        py: 0.875,
        borderBottom: last ? 'none' : `1px solid ${pick(theme, T.borderSubtle, '#27272a')}`,
        cursor: onClick ? 'pointer' : 'default',
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
 * Leading checkbox column — identical structure in header and every data row
 * (including empty spacer for non-selectable rows) so cells stay aligned.
 */
export const listCheckboxSx = {
  width: 40,
  minWidth: 40,
  flex: '0 0 40px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
} as const;

/**
 * Pin the first trailing fixed column (and everything after it) to the right
 * edge of the row. Required when data columns use fixed/resizable widths so
 * Actions does not sit mid-row with empty space after it.
 */
export const listPinEndSx = {
  marginLeft: 'auto',
} as const;

/**
 * Trailing actions — fixed width, always flush right of the row.
 */
export const listActionsSx = {
  width: 80,
  minWidth: 80,
  flex: '0 0 80px',
  marginLeft: 'auto',
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 0.25,
} as const;

/** Flexible text column. Use grow weights so columns share width evenly. */
export function listGrowSx(grow = 1, minWidth = 120): {
  flex: string;
  minWidth: number;
  overflow: 'hidden';
} {
  return {
    flex: `${grow} 1 0px`,
    minWidth,
    overflow: 'hidden',
  };
}

/** @deprecated prefer listGrowSx(1) — kept for imports */
export const listPrimaryColSx = listGrowSx(1, 120);
