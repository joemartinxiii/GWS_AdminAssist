import type { Theme } from '@mui/material/styles';
import { Box, IconButton, Typography, Select, MenuItem, FormControl } from '@mui/material';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { T, pick, selectMenuProps, textSecondary } from '../../theme/designTokens';

/** Default rows per page for dialog lists. */
export const DIALOG_LIST_PAGE_SIZE = 10;

const DEFAULT_ROWS_OPTIONS = [10, 20, 30, 50, 100];

/**
 * Footer for paged lists inside dialogs: rows-per-page select (same idea as main tables) plus range and prev/next.
 */
export function DialogListPagination({
  page,
  rowsPerPage,
  total,
  onPageChange,
  onRowsPerPageChange,
  rowsPerPageOptions = DEFAULT_ROWS_OPTIONS,
}: {
  page: number;
  rowsPerPage: number;
  total: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rows: number) => void;
  rowsPerPageOptions?: number[];
}) {
  // Hide the whole footer when the list fits within the smallest page size:
  // there's nothing to page through and no reason to change rows-per-page, so
  // "Rows per page … 1–2 of 2" is just noise on tiny lists.
  const minOption = rowsPerPageOptions.length ? Math.min(...rowsPerPageOptions) : DIALOG_LIST_PAGE_SIZE;
  if (total <= 0 || total <= minOption) return null;

  const safeRows = Math.max(1, rowsPerPage);
  const lastPage = Math.max(0, Math.ceil(total / safeRows) - 1);
  const safePage = Math.min(page, lastPage);
  const start = safePage * safeRows + 1;
  const end = Math.min((safePage + 1) * safeRows, total);

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1.5,
        py: 1,
        px: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (th) => textSecondary(th) }} component="span">
          Rows per page
        </Typography>
        <FormControl size="small" sx={{ minWidth: 76 }}>
          <Select
            value={safeRows}
            onChange={(e) => onRowsPerPageChange(Number(e.target.value))}
            MenuProps={{
              ...selectMenuProps,
              PaperProps: {
                sx: (theme: Theme) => {
                  const base =
                    typeof selectMenuProps.PaperProps.sx === 'function'
                      ? selectMenuProps.PaperProps.sx(theme)
                      : {};
                  const baseMenu = (base as { '& .MuiMenuItem-root'?: object })['& .MuiMenuItem-root'] ?? {};
                  return {
                    ...base,
                    '& .MuiMenuItem-root': {
                      ...baseMenu,
                      justifyContent: 'flex-end',
                      textAlign: 'right',
                    },
                  };
                },
              },
            }}
            sx={(th) => ({
              fontFamily: T.font,
              fontSize: '0.8125rem',
              '& .MuiSelect-select': {
                py: 0.5,
                textAlign: 'right',
                pr: '32px !important',
                pl: 1,
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                boxSizing: 'border-box',
              },
              '& .MuiSelect-icon': { right: 4 },
              '& fieldset': { borderColor: pick(th, T.border, '#3f3f46') },
            })}
          >
            {rowsPerPageOptions.map((n) => (
              <MenuItem key={n} value={n} sx={{ justifyContent: 'flex-end', textAlign: 'right' }}>
                {n}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 'auto' }}>
        <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (th) => textSecondary(th), mr: 0.5 }}>
          {start}–{end} of {total}
        </Typography>
        <IconButton size="small" disabled={safePage <= 0} onClick={() => onPageChange(safePage - 1)} aria-label="Previous page">
          <ChevronLeft size={18} strokeWidth={1.75} />
        </IconButton>
        <IconButton size="small" disabled={safePage >= lastPage} onClick={() => onPageChange(safePage + 1)} aria-label="Next page">
          <ChevronRight size={18} strokeWidth={1.75} />
        </IconButton>
      </Box>
    </Box>
  );
}
