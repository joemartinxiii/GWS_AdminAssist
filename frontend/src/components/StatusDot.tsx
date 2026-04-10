import type { ReactNode } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { T, textSecondary } from '../theme/designTokens';

/** Small status indicator; optional `label` is the tooltip on the dot. */
export function StatusDot({ color, label }: { color: string; label?: string }) {
  const dot = (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        bgcolor: color,
        flexShrink: 0,
      }}
    />
  );
  if (!label) return dot;
  return (
    <Tooltip title={label} placement="top" arrow>
      {dot}
    </Tooltip>
  );
}

/** Colored dot plus label text (People / list tables). */
export function DotLabel({
  dotColor,
  children,
  dotTooltip,
}: {
  dotColor: string;
  children: ReactNode;
  /** Tooltip on the dot; if omitted and `children` is a string, that string is used */
  dotTooltip?: string;
}) {
  const tip =
    dotTooltip ?? (typeof children === 'string' || typeof children === 'number' ? String(children) : undefined);
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <StatusDot color={dotColor} label={tip} />
      <Typography sx={{ fontFamily: T.font, fontSize: '0.75rem', color: (t) => textSecondary(t) }}>{children}</Typography>
    </Box>
  );
}
