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
  /** Rigid column width (px preferred). Ignored when `grow` is set (unless resizing). */
  width?: string | number;
  minWidth?: string | number;
  /** Flex grow weight — ignored when `resizable` + numeric width (resize uses fixed px). */
  grow?: number;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  /** Show drag handle to resize this column. */
  resizable?: boolean;
  /** Called when the user starts dragging the resize handle. */
  onResizeStart?: (e: React.MouseEvent) => void;
}

/**
 * Column header treatment (uppercase, tracked, sort arrows) used across data lists.
 * Optional right-edge drag handle for manual column widths.
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
  resizable = false,
  onResizeStart,
}: ColumnHeaderProps) {
  const active = sortConfig.key === columnId;
  // Resizable columns always use fixed pixel widths so drag feedback is predictable.
  const useFixed = resizable || (grow == null && width != null);
  const flex = useFixed
    ? `0 0 ${typeof width === 'number' ? `${width}px` : width ?? 'auto'}`
    : grow != null
      ? `${grow} 1 0px`
      : '1 1 0px';

  return (
    <Box
      onClick={() => (sortable && !resizable ? onSort(columnId) : undefined)}
      sx={(theme: Theme) => ({
        position: 'relative',
        width: useFixed ? width : grow != null ? undefined : width,
        minWidth: minWidth ?? (typeof width === 'number' ? width : grow != null ? 80 : 0),
        flex,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        gap: 0.25,
        cursor: sortable && !resizable ? 'pointer' : 'default',
        userSelect: 'none',
        fontSize: '0.6875rem',
        fontWeight: 600,
        fontFamily: T.font,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: active ? pick(theme, T.accent, '#8ab4f8') : textTertiary(theme),
        justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
        pr: resizable ? 1 : 0,
        '&:hover': sortable ? { color: pick(theme, T.text, '#e4e4e7') } : {},
        '&:hover .col-resize-handle': { opacity: 1 },
      })}
    >
      <Box
        onClick={(e) => {
          if (!sortable) return;
          e.stopPropagation();
          onSort(columnId);
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          minWidth: 0,
          overflow: 'hidden',
          cursor: sortable ? 'pointer' : 'default',
          flex: 1,
          justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
        }}
      >
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </Box>
        {sortable && active && (sortConfig.direction === 'asc' ? <ArrowUp size={14} strokeWidth={2} /> : <ArrowDown size={14} strokeWidth={2} />)}
      </Box>
      {resizable && onResizeStart && (
        <Box
          className="col-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label || columnId} column`}
          onMouseDown={onResizeStart}
          onClick={(e) => e.stopPropagation()}
          sx={(theme: Theme) => ({
            position: 'absolute',
            top: 0,
            right: 0,
            width: 8,
            height: '100%',
            cursor: 'col-resize',
            opacity: 0.35,
            zIndex: 2,
            display: 'flex',
            justifyContent: 'center',
            transition: 'opacity 0.12s ease',
            '&:hover': { opacity: 1 },
            '&::after': {
              content: '""',
              width: 2,
              height: '55%',
              alignSelf: 'center',
              borderRadius: 1,
              bgcolor: pick(theme, T.border, '#52525b'),
            },
            '&:hover::after': {
              bgcolor: pick(theme, T.accent, '#8ab4f8'),
            },
          })}
        />
      )}
    </Box>
  );
}
