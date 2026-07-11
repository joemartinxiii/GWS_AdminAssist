import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { T, pick, textSecondary, textTertiary } from '../../theme/designTokens';

export type PageHeaderProps = {
  title: string;
  /** One-line product lede under the title (max ~520px). */
  lede?: ReactNode;
  /** Counts / last-run / live state under the lede. */
  status?: ReactNode;
  /** CTAs under status (e.g. Run / Export on Audit). */
  statusActions?: ReactNode;
  /** Top-right, top-aligned with title (tabs/CTAs, or Audit score panel). */
  actions?: ReactNode;
};

/**
 * Shared page header recipe: title → lede → status → statusActions | actions.
 * See docs/ui.md §4b and tmp-product-feel mock.
 */
export function PageHeader({ title, lede, status, statusActions, actions }: PageHeaderProps) {
  return (
    <Box
      sx={{
        mb: 2.5,
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        gap: { xs: 2, md: 3 },
        alignItems: { md: 'flex-start' },
        justifyContent: 'space-between',
      }}
    >
      <Box sx={{ minWidth: 0, maxWidth: 560 }}>
        <Typography
          component="h1"
          sx={{
            fontFamily: T.font,
            fontWeight: 700,
            fontSize: '1.5rem',
            letterSpacing: '-0.02em',
            color: (th) => pick(th, T.text, '#fafafa'),
            m: 0,
          }}
        >
          {title}
        </Typography>
        {lede != null && lede !== '' && (
          <Typography
            sx={{
              fontFamily: T.font,
              fontSize: '0.8125rem',
              color: (t) => textSecondary(t),
              mt: 0.75,
              maxWidth: 520,
              lineHeight: 1.45,
            }}
          >
            {lede}
          </Typography>
        )}
        {status != null && status !== '' && (
          <Typography
            component="div"
            sx={{
              fontFamily: T.font,
              fontSize: '0.8125rem',
              color: (t) => textSecondary(t),
              mt: 1.25,
              lineHeight: 1.45,
              '& .page-status-live': {
                color: T.accent,
                fontWeight: 600,
              },
              '& .page-status-faint': {
                color: (t) => textTertiary(t),
              },
            }}
          >
            {status}
          </Typography>
        )}
        {statusActions != null && (
          <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center', flexWrap: 'wrap', mt: 1.25 }}>
            {statusActions}
          </Box>
        )}
      </Box>
      {actions != null && (
        <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', flexWrap: 'wrap', flexShrink: 0 }}>
          {actions}
        </Box>
      )}
    </Box>
  );
}
