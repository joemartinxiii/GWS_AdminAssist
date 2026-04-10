import type { Theme } from '@mui/material/styles';
import { T, selectMenuProps } from '../../theme/designTokens';

/** Shared TablePagination styling for data lists */
export function tablePaginationProps(_theme: Theme) {
  return {
    sx: {
      fontFamily: T.font,
      '& .MuiTablePagination-toolbar, & .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {
        fontFamily: T.font,
        fontSize: '0.8125rem',
      },
      '& .MuiInputBase-root': { fontFamily: T.font },
    },
    SelectProps: {
      sx: { '& .MuiSelect-select': { textAlign: 'right' as const, fontFamily: T.font } },
      MenuProps: {
        ...selectMenuProps,
        PaperProps: {
          sx: (th: Theme) => {
            const base =
              typeof selectMenuProps.PaperProps.sx === 'function'
                ? selectMenuProps.PaperProps.sx(th)
                : {};
            const baseMenu = (base as { '& .MuiMenuItem-root'?: object })['& .MuiMenuItem-root'] ?? {};
            return {
              ...base,
              '& .MuiMenuItem-root': {
                ...baseMenu,
                justifyContent: 'flex-end',
                textAlign: 'right',
                fontFamily: T.font,
              },
            };
          },
        },
      },
    },
  } as const;
}
