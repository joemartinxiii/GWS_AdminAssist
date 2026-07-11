import { Box } from '@mui/material';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { Theme } from '@mui/material/styles';
import { T, pick, textTertiary } from '../../theme/designTokens';

export interface SortConfigLite {
  key: string;
  direction: 'asc' | 'desc';
}

interface ColumnHeaderProps {
  label: string;
  columnId: string;
  sortConfig: SortConfigLite;
  onSort: (columnId: string) => void;
  width?: string | number;
  minWidth?: string | number;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
}

/**
 * Column header treatment (uppercase, tracked, sort arrows) used across data lists.
 */
export function ColumnHeader({
  label,
  columnId,
  sortConfig,
  onSort,
  width,
  minWidth,
  align = 'left',
  sortable = true,
}: ColumnHeaderProps) {
  const active = sortConfig.key === columnId;
  return (
    <Box
      onClick={() => (sortable ? onSort(columnId) : undefined)}
      sx={(theme: Theme) => ({
        width,
        minWidth: minWidth ?? width ?? 0,
        // Fixed-width cols don't grow; omit width → absorb leftover space (primary col).
        flexShrink: width ? 0 : 1,
        flex: width ? '0 0 auto' : '1 1 0',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        gap: 0.25,
        cursor: sortable ? 'pointer' : 'default',
        userSelect: 'none',
        fontSize: '0.6875rem',
        fontWeight: 600,
        fontFamily: T.font,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: active ? pick(theme, T.accent, '#8ab4f8') : textTertiary(theme),
        justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
        // Flush actions column to the trailing edge of the row.
        ...(align === 'right' && width ? { ml: 'auto' } : {}),
        '&:hover': sortable ? { color: pick(theme, T.text, '#e4e4e7') } : {},
      })}
    >
      {label}
      {sortable && active && (sortConfig.direction === 'asc' ? <ArrowUp size={14} strokeWidth={2} /> : <ArrowDown size={14} strokeWidth={2} />)}
    </Box>
  );
}
