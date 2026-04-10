import { Box } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { T, pick } from '../../theme/designTokens';

/** Outer bordered container for flex-based data lists */
export function listShellSx(theme: Theme) {
  return {
    border: `1px solid ${pick(theme, T.border, '#3f3f46')}`,
    borderRadius: T.radiusLg,
    overflow: 'hidden' as const,
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
        gap: 1.5,
        px: 2,
        py: 1.25,
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
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1,
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
