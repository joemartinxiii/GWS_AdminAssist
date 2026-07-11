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
  /** Rigid column width (px preferred). Ignored when `grow` is set. */
  width?: string | number;
  minWidth?: string | number;
  /** Flex grow weight — columns with grow share remaining width proportionally. */
  grow?: number;
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
  grow,
  align = 'left',
  sortable = true,
}: ColumnHeaderProps) {
  const active = sortConfig.key === columnId;
  const flex =
    grow != null
      ? `${grow} 1 0px`
      : width != null
        ? `0 0 ${typeof width === 'number' ? `${width}px` : width}`
        : '1 1 0px';
  return (
    <Box
      onClick={() => (sortable ? onSort(columnId) : undefined)}
      sx={(theme: Theme) => ({
        width: grow != null ? undefined : width,
        minWidth: minWidth ?? (typeof width === 'number' ? width : grow != null ? 80 : 0),
        flex,
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
        '&:hover': sortable ? { color: pick(theme, T.text, '#e4e4e7') } : {},
      })}
    >
      {label}
      {sortable && active && (sortConfig.direction === 'asc' ? <ArrowUp size={14} strokeWidth={2} /> : <ArrowDown size={14} strokeWidth={2} />)}
    </Box>
  );
}
