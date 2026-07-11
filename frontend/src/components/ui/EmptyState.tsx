import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { T, pick, textSecondary, textTertiary } from '../../theme/designTokens';

export type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  hint?: ReactNode;
  /** Max width of the card (default 520). */
  maxWidth?: number;
};

/**
 * Content-width first-run / empty card: icon tile, headline, value prop, CTA, hint.
 * See docs/ui.md §4c and tmp-product-feel mock.
 */
export function EmptyState({ icon, title, description, actions, hint, maxWidth = 520 }: EmptyStateProps) {
  return (
    <Box
      sx={(th) => ({
        mt: 1,
        border: `1px solid ${pick(th, T.border, '#3f3f46')}`,
        borderRadius: T.radiusLg,
        bgcolor: pick(th, T.surface, '#18181b'),
        px: 4,
        py: 6,
        textAlign: 'center',
        maxWidth,
      })}
    >
      <Box
        sx={(th) => ({
          width: 48,
          height: 48,
          mx: 'auto',
          mb: 2,
          borderRadius: '14px',
          bgcolor: pick(th, T.accentSoft, 'rgba(26, 115, 232, 0.16)'),
          color: pick(th, T.accent, '#8ab4f8'),
          display: 'grid',
          placeItems: 'center',
        })}
      >
        {icon}
      </Box>
      <Typography
        component="h2"
        sx={{
          fontFamily: T.font,
          fontWeight: 700,
          fontSize: '1.0625rem',
          letterSpacing: '-0.02em',
          color: (th) => pick(th, T.text, '#fafafa'),
          mb: 1,
        }}
      >
        {title}
      </Typography>
      <Typography
        sx={{
          fontFamily: T.font,
          fontSize: '0.84375rem',
          color: (t) => textSecondary(t),
          maxWidth: 360,
          mx: 'auto',
          mb: 2.5,
          lineHeight: 1.5,
        }}
      >
        {description}
      </Typography>
      {actions != null && (
        <Box sx={{ display: 'flex', gap: 1.25, justifyContent: 'center', flexWrap: 'wrap' }}>{actions}</Box>
      )}
      {hint != null && hint !== '' && (
        <Typography
          sx={{
            fontFamily: T.font,
            fontSize: '0.75rem',
            color: (t) => textTertiary(t),
            mt: 2,
          }}
        >
          {hint}
        </Typography>
      )}
    </Box>
  );
}
