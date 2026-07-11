import { Box } from '@mui/material';
import { ChevronRight } from 'lucide-react';
import { textTertiary } from '../../theme/designTokens';

/**
 * Trailing chevron for row-open lists (Security Audit pattern).
 * Pin with listActionsSx / listPinEndSx on the parent cell.
 */
export function ListChevron({ size = 18 }: { size?: number }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: 36,
        flex: '0 0 36px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        color: (t) => textTertiary(t),
        lineHeight: 0,
        flexShrink: 0,
      }}
    >
      <ChevronRight size={size} strokeWidth={1.75} />
    </Box>
  );
}
